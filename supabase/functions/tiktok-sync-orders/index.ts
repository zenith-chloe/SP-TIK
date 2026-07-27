// Pulls recent orders from TikTok Shop for one (or all) connected shop(s) and
// upserts them into `orders` / `order_items`.
//
// Body (optional): { "shopId": "...", "fullSync": true }  -- omit shopId to
// sync all connected shops; fullSync forces a full historical walk instead
// of an incremental (update_time-based) sync.
//
// Full sync is resumable: each page's next_page_token is checkpointed into
// `platform_sync_progress` right after that page's orders are written. If
// the Edge Function gets killed mid-run (Supabase enforces a hard wall-clock
// execution limit, independent of any caller-side timeout), the next
// `fullSync: true` invocation picks up from the saved cursor instead of
// restarting from page 1. Only marked `status='completed'` once TikTok stops
// returning a next_page_token.
//
// Add ?debug=1 to see the raw TikTok response instead of syncing.
//
// Optional secret SYNC_TRIGGER_SECRET: if set, callers must send header
// `x-sync-secret: <value>` or the request is rejected.
//
// Required secrets: TIKTOK_APP_KEY, TIKTOK_APP_SECRET
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  API_HOST,
  mapTikTokOrderStatus,
  nowTs,
  requireTikTokCredentials,
  signApiRequest,
  type TikTokCredentials,
} from "./tiktok.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function tiktokCall(
  method: "GET" | "POST",
  path: string,
  creds: TikTokCredentials,
  accessToken: string,
  extraQuery: Record<string, string>,
  body?: Record<string, unknown>,
) {
  const timestamp = String(nowTs());
  const queryParams: Record<string, string> = { app_key: creds.appKey, timestamp, ...extraQuery };
  const rawBody = body ? JSON.stringify(body) : "";
  const sign = await signApiRequest(path, creds, queryParams, rawBody);

  const url = new URL(`${API_HOST}${path}`);
  for (const [k, v] of Object.entries(queryParams)) url.searchParams.set(k, v);
  url.searchParams.set("sign", sign);

  const resp = await fetch(url.toString(), {
    method,
    headers: { "Content-Type": "application/json", "x-tts-access-token": accessToken },
    body: method === "POST" ? rawBody : undefined,
  });
  const data = await resp.json();
  if (!resp.ok || data.code !== 0) {
    throw new Error(`${path} failed: ${data.code ?? resp.status} ${data.message ?? ""}`);
  }
  return data.data;
}

// Deducts stock for one order_item, exactly once, via the stock_movements
// UNIQUE(order_id, sku) constraint: the insert only succeeds the first time
// this (order, sku) pair is seen, so re-syncing the same order (which
// happens on every run within the 30-day window) never double-deducts.
async function deductStockForItem(
  orderId: string,
  sku: string,
  qty: number,
  platform: "tiktok" | "shopee",
  orderStatus: string,
  platformStatus: string | null,
) {
  if (platformStatus === "UNPAID" || orderStatus === "cancelled") return;

  const { data: product } = await supabase
    .from("products")
    .select("id, warehouse_a_qty")
    .eq("sku", sku)
    .maybeSingle();
  if (!product) return;

  const stockBefore = Math.max(product.warehouse_a_qty ?? 0, 0);
  // Never let warehouse_a_qty go negative: deduct at most what's actually there.
  const actualDeduction = Math.min(qty, stockBefore);
  const stockAfter = stockBefore - actualDeduction;
  const insufficientStock = actualDeduction < qty;

  const { data: inserted, error: insertErr } = await supabase
    .from("stock_movements")
    .insert({
      product_id: product.id,
      sku,
      order_id: orderId,
      platform,
      qty_deducted: actualDeduction,
      stock_before: stockBefore,
      stock_after: stockAfter,
    })
    .select("id")
    .maybeSingle();

  if (insertErr) {
    if (insertErr.code === "23505") return; // already deducted for this order+sku
    await supabase.from("sync_logs").insert({
      action: "stock_deduction",
      status: "failed",
      message: `order ${orderId} sku ${sku}: ${insertErr.message}`,
    });
    return;
  }
  if (!inserted) return;

  const { error: updateErr } = await supabase
    .from("products")
    .update({ warehouse_a_qty: stockAfter })
    .eq("id", product.id);
  if (updateErr) {
    await supabase.from("sync_logs").insert({
      action: "stock_deduction",
      status: "failed",
      message: `order ${orderId} sku ${sku}: product update failed - ${updateErr.message}`,
    });
    return;
  }

  if (insufficientStock) {
    await supabase.from("sync_logs").insert({
      action: "stock_deduction",
      status: "failed",
      message: `order ${orderId} sku ${sku}: insufficient stock, wanted ${qty} but only had ${stockBefore} — deducted ${actualDeduction} and stopped at 0`,
    });
  }
}

async function ensureShopCipher(
  creds: TikTokCredentials,
  account: { id: string; shop_id: string; access_token: string; shop_cipher: string | null },
): Promise<{ shopCipher: string; realShopId: string }> {
  if (account.shop_cipher) return { shopCipher: account.shop_cipher, realShopId: account.shop_id };

  const data = await tiktokCall("GET", "/authorization/202309/shops", creds, account.access_token, {});
  const shop = (data.shops ?? [])[0];
  if (!shop) throw new Error("No authorized shop found for this account");

  await supabase
    .from("platform_accounts")
    .update({ shop_cipher: shop.cipher, shop_id: shop.id })
    .eq("id", account.id);

  return { shopCipher: shop.cipher, realShopId: shop.id };
}

async function upsertOrderPage(
  // deno-lint-ignore no-explicit-any
  pageOrders: any[],
  account: { id: string },
): Promise<{ syncedOrders: number; syncedItems: number }> {
  let syncedOrders = 0;
  let syncedItems = 0;

  for (const o of pageOrders) {
    const { data: orderRow, error: orderErr } = await supabase
      .from("orders")
      .upsert(
        {
          platform: "tiktok",
          platform_account_id: account.id,
          order_no: o.id,
          buyer_name: o.recipient_address?.name ?? "—",
          buyer_phone: o.recipient_address?.phone_number ?? "—",
          shipping_address: o.recipient_address?.full_address ?? "—",
          courier: o.shipping_provider ?? null,
          tracking_no: o.tracking_number ?? null,
          order_status: mapTikTokOrderStatus(o.status),
          platform_status: o.status ?? null,
          is_cod: o.is_cod ?? false,
          total_amount: Number(o.payment?.total_amount ?? 0),
          shipping_fee: Number(o.payment?.shipping_fee ?? 0),
          order_date: o.create_time ? new Date(Number(o.create_time) * 1000).toISOString() : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "platform,order_no" },
      )
      .select("id")
      .single();

    if (orderErr || !orderRow) {
      await supabase.from("sync_logs").insert({
        action: "tiktok_sync_order",
        status: "failed",
        message: `${o.id}: ${orderErr?.message ?? "unknown error"}`,
      });
      continue;
    }
    syncedOrders++;

    // TikTok sends one line_item per unit (qty is always 1 on each), so if the
    // same SKU appears in multiple line_items on this order they must be
    // summed here first — otherwise the order_items upsert (keyed on
    // order_id+sku) would just overwrite qty=1 with qty=1 again, and the
    // stock_movements idempotency guard would silently skip the deduction
    // for every line_item after the first, under-deducting stock.
    const itemsBySku = new Map<string, { productName: string; variation: string | null; qty: number; subtotal: number; imageUrl: string | null }>();
    for (const item of o.line_items ?? []) {
      const sku = item.seller_sku || item.sku_id || String(item.id);
      const salePrice = Number(item.sale_price ?? 0);
      const existing = itemsBySku.get(sku);
      if (existing) {
        existing.qty += 1;
        existing.subtotal += salePrice;
      } else {
        itemsBySku.set(sku, {
          productName: item.product_name,
          variation: item.sku_name ?? null,
          qty: 1,
          subtotal: salePrice,
          imageUrl: item.sku_image ?? null,
        });
      }
    }

    for (const [sku, grouped] of itemsBySku) {
      const { error: itemErr } = await supabase.from("order_items").upsert(
        {
          order_id: orderRow.id,
          sku,
          product_name: grouped.productName,
          variation: grouped.variation,
          qty: grouped.qty,
          unit_price: grouped.subtotal / grouped.qty,
          subtotal: grouped.subtotal,
          image_url: grouped.imageUrl,
        },
        { onConflict: "order_id,sku" },
      );
      if (!itemErr) {
        syncedItems++;
        await deductStockForItem(orderRow.id, sku, grouped.qty, "tiktok", mapTikTokOrderStatus(o.status), o.status ?? null);
      }
    }
  }

  return { syncedOrders, syncedItems };
}

async function syncOneShop(
  creds: TikTokCredentials,
  account: { id: string; shop_id: string; access_token: string; shop_cipher: string | null; last_synced_at: string | null },
  fullSync: boolean,
) {
  const { shopCipher } = await ensureShopCipher(creds, account);

  // Full sync (explicitly requested, or this shop has never synced before):
  // no time filter, walk every page, so every historical order/status
  // (IN_TRANSIT/DELIVERED/COMPLETED/CANCELLED/...) gets saved, not just the
  // newest 50. Incremental sync filters+sorts by update_time (not
  // create_time) — an order created weeks ago that only just moved to
  // IN_TRANSIT has an old create_time but a fresh update_time, so filtering
  // on create_time_ge alone silently missed it even though it just changed.
  const isFirstSync = fullSync || !account.last_synced_at;
  const baseQuery: Record<string, string> = { shop_cipher: shopCipher, page_size: "50" };
  const body: Record<string, unknown> = {};

  if (isFirstSync) {
    baseQuery.sort_field = "create_time";
    baseQuery.sort_order = "DESC";
  } else {
    const sinceTs = Math.floor(new Date(account.last_synced_at!).getTime() / 1000);
    body.update_time_ge = sinceTs;
    baseQuery.sort_field = "update_time";
    baseQuery.sort_order = "DESC";
  }

  // Resume a full sync from its saved checkpoint instead of restarting at
  // page 1. Supabase enforces its own hard wall-clock execution limit on
  // Edge Functions (observed: killed around ~150s, status 546) independent
  // of any client-side timeout, so a single invocation can never be
  // guaranteed to reach the last page for a shop with thousands of orders —
  // this makes that survivable across many invocations instead of a bug.
  let pageToken: string | undefined;
  let cumulativePages = 0;
  let cumulativeOrders = 0;
  if (isFirstSync) {
    const { data: progress } = await supabase
      .from("platform_sync_progress")
      .select("next_page_token, pages_fetched, orders_synced, status")
      .eq("account_id", account.id)
      .maybeSingle();
    if (progress && progress.status === "in_progress") {
      pageToken = progress.next_page_token ?? undefined;
      cumulativePages = progress.pages_fetched;
      cumulativeOrders = progress.orders_synced;
    } else {
      await supabase.from("platform_sync_progress").upsert(
        {
          account_id: account.id,
          next_page_token: null,
          pages_fetched: 0,
          orders_synced: 0,
          status: "in_progress",
          sync_type: "full",
          last_error: null,
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "account_id" },
      );
    }
  }

  // One time budget covers BOTH fetching a page and writing it — the earlier
  // version only bounded the fetch loop, leaving the per-order DB-write loop
  // completely unbounded, which is what let a run silently keep processing
  // past both the pg_net caller's timeout and this budget until Supabase
  // itself killed it. 100s leaves margin under the ~150s observed hard kill.
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 100000;
  const MAX_PAGES_PER_INVOCATION = 500; // sanity cap, time budget hits first in practice
  let pageCount = 0;
  let syncedOrders = 0;
  let syncedItems = 0;
  let truncated = false;
  let reachedLastPage = false;

  try {
    do {
      const query = pageToken ? { ...baseQuery, page_token: pageToken } : baseQuery;
      const searchData = await tiktokCall("POST", "/order/202309/orders/search", creds, account.access_token, query, body);
      const pageOrders = searchData.orders ?? [];
      pageToken = searchData.next_page_token || undefined;
      pageCount++;

      const pageResult = await upsertOrderPage(pageOrders, account);
      syncedOrders += pageResult.syncedOrders;
      syncedItems += pageResult.syncedItems;

      if (isFirstSync) {
        cumulativePages++;
        cumulativeOrders += pageResult.syncedOrders;
        await supabase
          .from("platform_sync_progress")
          .update({
            next_page_token: pageToken ?? null,
            pages_fetched: cumulativePages,
            orders_synced: cumulativeOrders,
            updated_at: new Date().toISOString(),
          })
          .eq("account_id", account.id);
      }

      if (!pageToken) {
        reachedLastPage = true;
        break;
      }
      if (pageCount >= MAX_PAGES_PER_INVOCATION || Date.now() - startedAt > TIME_BUDGET_MS) {
        truncated = true;
        break;
      }
    } while (pageToken);
  } catch (e) {
    if (isFirstSync) {
      await supabase
        .from("platform_sync_progress")
        .update({ last_error: (e as Error).message, updated_at: new Date().toISOString() })
        .eq("account_id", account.id);
    }
    throw e;
  }

  if (isFirstSync) {
    if (reachedLastPage) {
      await supabase
        .from("platform_sync_progress")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("account_id", account.id);
      await supabase.from("platform_accounts").update({ last_synced_at: new Date().toISOString() }).eq("id", account.id);
    }
    // else: left status='in_progress' with the checkpointed cursor, picked up by the next fullSync:true call.
  } else if (!truncated) {
    // Incremental sync only advances last_synced_at if it wasn't cut short,
    // so the next run's update_time_ge window doesn't skip anything.
    await supabase.from("platform_accounts").update({ last_synced_at: new Date().toISOString() }).eq("id", account.id);
  }

  await supabase.from("sync_logs").insert({
    action: "tiktok_sync_shop",
    status: truncated ? "partial" : "success",
    message: `shop ${account.shop_id}: +${syncedOrders} orders, +${syncedItems} items this run, ${pageCount} page(s) this run, mode=${isFirstSync ? "full" : "incremental"}` +
      (isFirstSync ? ` — cumulative ${cumulativeOrders} orders / ${cumulativePages} pages, ${reachedLastPage ? "COMPLETE" : "in progress, resumable"}` : "") +
      (truncated ? " — stopped by time budget, will resume next invocation" : ""),
  });

  return {
    shopId: account.shop_id,
    syncedOrders,
    syncedItems,
    pages: pageCount,
    mode: isFirstSync ? "full" : "incremental",
    truncated,
    fullSyncDone: isFirstSync ? reachedLastPage : undefined,
    fullSyncCumulativeOrders: isFirstSync ? cumulativeOrders : undefined,
    fullSyncCumulativePages: isFirstSync ? cumulativePages : undefined,
  };
}

Deno.serve(async (req: Request) => {
  const requiredSecret = Deno.env.get("SYNC_TRIGGER_SECRET");
  if (requiredSecret && req.headers.get("x-sync-secret") !== requiredSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let creds;
  try {
    creds = requireTikTokCredentials();
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let shopId: string | undefined;
  let fullSync = false;
  try {
    const body = await req.json();
    shopId = body?.shopId;
    fullSync = body?.fullSync === true;
  } catch {
    // no body - sync all shops
  }

  let query = supabase
    .from("platform_accounts")
    .select("id, shop_id, access_token, shop_cipher, last_synced_at")
    .eq("platform", "tiktok")
    .eq("status", "connected")
    .not("access_token", "is", null);
  if (shopId) query = query.eq("shop_id", shopId);

  const { data: accounts, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!accounts || accounts.length === 0) {
    return new Response(JSON.stringify({ error: "No connected TikTok shop with a saved access_token found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  if (url.searchParams.get("debug") === "1") {
    try {
      const { shopCipher } = await ensureShopCipher(creds, accounts[0]);
      if (url.searchParams.get("endpoint") === "warehouses") {
        const warehouseData = await tiktokCall(
          "GET",
          "/logistics/202309/warehouses",
          creds,
          accounts[0].access_token,
          { shop_cipher: shopCipher },
        );
        return new Response(JSON.stringify({ shopCipher, warehouseData }, null, 2), {
          headers: { "Content-Type": "application/json" },
        });
      }
      const statusParam = url.searchParams.get("status");
      const searchData = await tiktokCall(
        "POST",
        "/order/202309/orders/search",
        creds,
        accounts[0].access_token,
        { shop_cipher: shopCipher, page_size: "5", sort_field: "create_time", sort_order: "DESC" },
        statusParam ? { order_status: statusParam } : {},
      );
      return new Response(JSON.stringify({ shopCipher, statusParam, searchData }, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const results = [];
  for (const account of accounts) {
    try {
      results.push(await syncOneShop(creds, account, fullSync));
    } catch (e) {
      await supabase.from("sync_logs").insert({
        action: "tiktok_sync_shop",
        status: "failed",
        message: `shop ${account.shop_id}: ${(e as Error).message}`,
      });
      results.push({ shopId: account.shop_id, error: (e as Error).message });
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { "Content-Type": "application/json" },
  });
});
