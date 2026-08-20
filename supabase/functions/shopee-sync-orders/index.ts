// Pulls recent orders from Shopee for one (or all) connected shop(s) and
// upserts them into `orders` / `order_items`. Call this from a button in the
// frontend, or wire it to a cron schedule later.
//
// Body (optional): { "shopId": "123456" }  -- omit to sync all connected shops
// Body (optional): { "platformAccountId": "...", "orderSns": ["..."] } --
// 2026-08-20, new: force a targeted resync of specific real order_sns for
// one account, bypassing the incremental time-window scan entirely. Reuses
// the exact same upsertShopeeOrderBatch logic as the normal pass (no
// duplicated/parallel code path) — added so a known-bad order (wrong
// item-grouping from before the fix below) can be corrected immediately
// instead of waiting for it to naturally re-enter the rolling sync window.
//
// Optional secret SYNC_TRIGGER_SECRET: if set, callers must send header
// `x-sync-secret: <value>` or the request is rejected. Set this once you
// wire the sync button up for real, to stop randoms hitting the URL.
//
// Required secrets: SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY, SHOPEE_ENV
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  mapShopeeOrderStatus,
  requireShopeeCredentials,
  shopeeHost,
  signRequest,
  type ShopeeCredentials,
} from "./shopee.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Browser callers (supabaseClient.functions.invoke) send a CORS preflight
// OPTIONS request first. Without these headers the preflight response
// doesn't grant the browser permission to send the real POST, so it never
// leaves the browser — this must be checked before any other logic, or an
// OPTIONS request (no body) falls through into "sync all shops".
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Deducts stock for one order_item, exactly once, via the stock_movements
// UNIQUE(order_id, sku) constraint: the insert only succeeds the first time
// this (order, sku) pair is seen, so re-syncing the same order (which
// happens on every run within the sync window) never double-deducts.
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

async function refreshTokenIfNeeded(
  creds: ShopeeCredentials,
  account: { id: string; shop_id: string; access_token: string; refresh_token: string; token_expires_at: string },
) {
  const expiresAt = new Date(account.token_expires_at).getTime();
  const fiveMinutes = 5 * 60 * 1000;
  if (expiresAt - Date.now() > fiveMinutes) {
    return account.access_token; // still valid
  }

  const path = "/api/v2/auth/access_token/get";
  const { timestamp, sign } = await signRequest(path, creds);
  const refreshUrl = new URL(`${shopeeHost()}${path}`);
  refreshUrl.searchParams.set("partner_id", creds.partnerId);
  refreshUrl.searchParams.set("timestamp", String(timestamp));
  refreshUrl.searchParams.set("sign", sign);

  const resp = await fetch(refreshUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      partner_id: Number(creds.partnerId),
      shop_id: Number(account.shop_id),
      refresh_token: account.refresh_token,
    }),
  });
  const data = await resp.json();
  if (!resp.ok || data.error) {
    throw new Error(`Token refresh failed: ${data.error ?? resp.status} ${data.message ?? ""}`);
  }

  const newExpiresAt = new Date(Date.now() + (Number(data.expire_in) || 14400) * 1000).toISOString();
  await supabase
    .from("platform_accounts")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: newExpiresAt,
    })
    .eq("id", account.id);

  return data.access_token as string;
}

async function shopeeGet(
  path: string,
  creds: ShopeeCredentials,
  shopId: string,
  accessToken: string,
  extraParams: Record<string, string>,
) {
  const { timestamp, sign } = await signRequest(path, creds, { shopId, accessToken });
  const url = new URL(`${shopeeHost()}${path}`);
  url.searchParams.set("partner_id", creds.partnerId);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);
  url.searchParams.set("shop_id", shopId);
  url.searchParams.set("access_token", accessToken);
  for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);

  const resp = await fetch(url.toString());
  const data = await resp.json();
  if (!resp.ok || data.error) {
    throw new Error(`${path} failed: ${data.error ?? resp.status} ${data.message ?? ""}`);
  }
  return data;
}

// Fetches order_detail for one batch (<=50 order_sns) and upserts each order
// + its items. Extracted unchanged from the previous single-pass version so
// the per-order/per-item mapping logic is identical — only the caller now
// invokes this once per get_order_list page instead of once for the whole
// order_sn list collected up front.
async function upsertShopeeOrderBatch(
  creds: ShopeeCredentials,
  account: { id: string; shop_id: string },
  accessToken: string,
  batch: string[],
): Promise<{ syncedOrders: number; syncedItems: number }> {
  let syncedOrders = 0;
  let syncedItems = 0;
  if (batch.length === 0) return { syncedOrders, syncedItems };

  const detailResp = await shopeeGet("/api/v2/order/get_order_detail", creds, account.shop_id, accessToken, {
    order_sn_list: batch.join(","),
    // buyer_user_id + buyer_username (2026-08-20) — for the order drawer's
    // 即时聊天 button. buyer_user_id (numeric) turned out not to work as a
    // Shopee webchat URL query param (confirmed live); buyer_username (the
    // buyer's real account handle string) is fetched instead, for a
    // copy-to-clipboard workflow. Purely additive fields, doesn't change
    // any existing item/status/fee mapping below.
    response_optional_fields: "item_list,recipient_address,total_amount,shipping_carrier,order_status,cod,buyer_user_id,buyer_username",
  });

  for (const o of detailResp.response?.order_list ?? []) {
    const { data: orderRow, error: orderErr } = await supabase
      .from("orders")
      .upsert(
        {
          platform: "shopee",
          platform_account_id: account.id,
          order_no: o.order_sn,
          buyer_name: o.recipient_address?.name ?? "—",
          buyer_phone: o.recipient_address?.phone ?? "—",
          shipping_address: o.recipient_address?.full_address ?? "—",
          buyer_user_id: o.buyer_user_id ?? null,
          buyer_username: o.buyer_username ?? null,
          courier: o.shipping_carrier ?? null,
          tracking_no: null,
          order_status: mapShopeeOrderStatus(o.order_status),
          platform_status: o.order_status ?? null,
          is_cod: o.cod ?? false,
          total_amount: o.total_amount ?? 0,
          shipping_fee: 0,
          order_date: o.create_time ? new Date(o.create_time * 1000).toISOString() : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "platform,order_no" },
      )
      .select("id")
      .single();

    if (orderErr || !orderRow) {
      await supabase.from("sync_logs").insert({
        action: "shopee_sync_order",
        status: "failed",
        message: `${o.order_sn}: ${orderErr?.message ?? "unknown error"}`,
      });
      continue;
    }
    syncedOrders++;

    // Group real Shopee item_list entries into DB rows keyed on a value
    // that's unique PER VARIATION, not just per parent product — otherwise
    // two different real order lines (e.g. model "14T" and model "36T" of
    // the same product) silently collapse into one row with summed qty,
    // dropping the second variation entirely (confirmed live on order
    // 260820SQAQY3MW: 14T×1 + 36T×1 → merged into one "14T ×2" row).
    //
    // 2026-08-20 fix: only group under a shared key when Shopee gives a
    // real per-variation identifier that's ACTUALLY the same across both
    // lines — model_sku/item_sku when the seller set one (the original,
    // legitimate reason this grouping step exists: real SKU collisions
    // across separate order lines), else model_id (Shopee's own real
    // per-variation ID, always distinct between different variations of
    // the same product) combined with item_id for cross-product
    // uniqueness, else item_id alone only as a last resort for items with
    // no variation at all. Previously fell straight from model_sku/
    // item_sku to item_id alone, which conflated every variation of a
    // product with no seller-set SKU into a single group.
    const itemsByKey = new Map<string, { sku: string; productName: string; variation: string | null; qty: number; subtotal: number; imageUrl: string | null }>();
    for (const item of o.item_list ?? []) {
      const realSku = item.model_sku || item.item_sku || "";
      const groupKey = realSku || (item.model_id ? `${item.item_id}:${item.model_id}` : String(item.item_id));
      const qty = item.model_quantity_purchased ?? 1;
      const unitPrice = item.model_discounted_price ?? item.model_original_price ?? 0;
      const subtotal = unitPrice * qty;
      const existing = itemsByKey.get(groupKey);
      if (existing) {
        existing.qty += qty;
        existing.subtotal += subtotal;
      } else {
        itemsByKey.set(groupKey, {
          // Stored `sku` column: the real seller SKU when Shopee provided
          // one, else the same synthetic per-variation key used for
          // grouping above (order_items has a UNIQUE(order_id, sku)
          // constraint, so this must stay unique per real variation —
          // an empty string for every no-SKU variation would violate it
          // the same way item_id-alone did).
          sku: realSku || groupKey,
          productName: item.item_name,
          variation: item.model_name ?? null,
          qty,
          subtotal,
          imageUrl: item.image_info?.image_url ?? null,
        });
      }
    }

    // 2026-08-20 fix #2: remove any order_items row for this order that is
    // NOT part of the freshly computed set above. Needed because upsert
    // below only matches on (order_id, sku) — if a sku VALUE changes
    // between sync passes (e.g. this exact order was first synced before
    // the model_id-composite-key fix above existed, when its only item was
    // stored under the old bare-item_id sku, and a later resync now stores
    // it under the new item_id:model_id sku) the upsert can't detect
    // "this is the same real line, just renamed" — it just inserts a
    // second row alongside the untouched old one, so Shopee's real single
    // item shows twice in the ERP (confirmed live on order 260820SU7THRCX:
    // Shopee's own get_order_detail returns exactly one item_list entry,
    // but order_items had two rows — one stale from the old sku scheme).
    // A plain delete-then-reinsert per sync pass is intentionally NOT used
    // instead (would erase warehouse-picking-state history the moment a
    // richer feature to track that exists) — this stays a minimal
    // stale-only delete, order_items itself carries no per-row state today.
    const finalSkus = new Set([...itemsByKey.values()].map((g) => g.sku));
    const { data: existingItemRows } = await supabase
      .from("order_items")
      .select("id, sku")
      .eq("order_id", orderRow.id);
    const staleIds = (existingItemRows ?? [])
      .filter((row) => !finalSkus.has(row.sku))
      .map((row) => row.id);
    if (staleIds.length > 0) {
      await supabase.from("order_items").delete().in("id", staleIds);
    }

    for (const [, grouped] of itemsByKey) {
      const { error: itemErr } = await supabase.from("order_items").upsert(
        {
          order_id: orderRow.id,
          sku: grouped.sku,
          product_name: grouped.productName,
          variation: grouped.variation,
          qty: grouped.qty,
          unit_price: grouped.qty > 0 ? grouped.subtotal / grouped.qty : 0,
          subtotal: grouped.subtotal,
          image_url: grouped.imageUrl,
        },
        { onConflict: "order_id,sku" },
      );
      if (!itemErr) {
        syncedItems++;
        await deductStockForItem(orderRow.id, grouped.sku, grouped.qty, "shopee", mapShopeeOrderStatus(o.order_status), o.order_status ?? null);
      }
    }
  }

  return { syncedOrders, syncedItems };
}

// Time budget per invocation, leaving headroom under Supabase's own worker
// limit (this replaced a single unbounded pass that hit WORKER_RESOURCE_LIMIT
// once a shop had real order volume — see sync_logs 2026-08-10).
const TIME_BUDGET_MS = 90000;
// A platform_sync_progress row idle this long while status='in_progress' is
// treated as an abandoned invocation (crashed, never returned) rather than a
// still-running one. Resuming from its last checkpoint is always safe (see
// upsert-on-conflict design below), so recovery is just "continue normally"
// plus a note in sync_logs — no separate "abandoned" state needed.
const STALE_IN_PROGRESS_MS = 15 * 60 * 1000;

async function syncOneShop(creds: ShopeeCredentials, account: {
  id: string;
  shop_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
}) {
  const accessToken = await refreshTokenIfNeeded(creds, account);
  const deadline = Date.now() + TIME_BUDGET_MS;

  const { data: progress } = await supabase
    .from("platform_sync_progress")
    .select("next_page_token, sync_window_from, sync_window_to, status, orders_synced, pages_fetched, updated_at")
    .eq("account_id", account.id)
    .maybeSingle();

  let windowFrom: number;
  let windowTo: number;
  let cursor: string;
  let cumulativeOrders: number;
  let cumulativePages: number;
  const nowIso = new Date().toISOString();

  if (!progress || progress.status !== "in_progress") {
    // Fresh pass: window is computed once, here, and then persisted — every
    // subsequent resume of THIS pass reads it back instead of recomputing
    // "now", so time_from/time_to can't drift across invocations.
    const now = Math.floor(Date.now() / 1000);
    windowFrom = now - 15 * 24 * 60 * 60;
    windowTo = now;
    cursor = "";
    cumulativeOrders = 0;
    cumulativePages = 0;
    await supabase.from("platform_sync_progress").upsert(
      {
        account_id: account.id,
        next_page_token: null,
        sync_window_from: windowFrom,
        sync_window_to: windowTo,
        pages_fetched: 0,
        orders_synced: 0,
        status: "in_progress",
        sync_type: "incremental",
        last_error: null,
        started_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "account_id" },
    );
  } else {
    // Resume: window and cursor come from the stored checkpoint, unchanged.
    windowFrom = progress.sync_window_from!;
    windowTo = progress.sync_window_to!;
    cursor = progress.next_page_token ?? "";
    cumulativeOrders = progress.orders_synced ?? 0;
    cumulativePages = progress.pages_fetched ?? 0;

    const idleMs = Date.now() - new Date(progress.updated_at).getTime();
    if (idleMs > STALE_IN_PROGRESS_MS) {
      await supabase.from("sync_logs").insert({
        action: "shopee_sync_shop",
        status: "success",
        message: `shop ${account.shop_id}: resuming stale in_progress checkpoint (idle ${Math.round(idleMs / 60000)}min), continuing from page ${cumulativePages}`,
      });
    }
  }

  let runSyncedOrders = 0;
  let runSyncedItems = 0;
  let reachedEnd = false;

  try {
    while (true) {
      const listResp = await shopeeGet("/api/v2/order/get_order_list", creds, account.shop_id, accessToken, {
        time_range_field: "update_time",
        time_from: String(windowFrom),
        time_to: String(windowTo),
        page_size: "50",
        ...(cursor ? { cursor } : {}),
      });
      const pageOrders: { order_sn: string }[] = listResp.response?.order_list ?? [];
      const orderSns = pageOrders.map((o) => o.order_sn);
      const more = !!listResp.response?.more && !!listResp.response?.next_cursor;
      const nextCursor: string = listResp.response?.next_cursor ?? "";

      // Detail fetch + upsert for this page only, THEN checkpoint — the
      // checkpoint write below only happens once list+detail+upsert have all
      // completed for this page, so a page can never be recorded as done
      // half-way through.
      const pageResult = await upsertShopeeOrderBatch(creds, account, accessToken, orderSns);
      runSyncedOrders += pageResult.syncedOrders;
      runSyncedItems += pageResult.syncedItems;
      cumulativeOrders += pageResult.syncedOrders;
      cumulativePages += 1;
      cursor = more ? nextCursor : "";

      await supabase.from("platform_sync_progress").update({
        next_page_token: more ? nextCursor : null,
        pages_fetched: cumulativePages,
        orders_synced: cumulativeOrders,
        updated_at: new Date().toISOString(),
      }).eq("account_id", account.id);

      if (!more) {
        reachedEnd = true;
        break;
      }
      if (Date.now() > deadline) break; // time budget hit — stay in_progress, resume next invocation
    }
  } catch (e) {
    await supabase.from("platform_sync_progress").update({
      last_error: (e as Error).message,
      updated_at: new Date().toISOString(),
    }).eq("account_id", account.id);
    throw e;
  }

  if (reachedEnd) {
    await supabase.from("platform_sync_progress").update({
      status: "completed",
      updated_at: new Date().toISOString(),
    }).eq("account_id", account.id);
    await supabase
      .from("platform_accounts")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", account.id);
    await supabase.from("sync_logs").insert({
      action: "shopee_sync_shop",
      status: "success",
      message: `shop ${account.shop_id}: pass COMPLETE, +${runSyncedOrders} orders this run (${cumulativeOrders} total / ${cumulativePages} pages this pass), +${runSyncedItems} items this run`,
    });
  } else {
    await supabase.from("sync_logs").insert({
      action: "shopee_sync_shop",
      status: "success",
      message: `shop ${account.shop_id}: +${runSyncedOrders} orders this run, ${cumulativePages} pages cumulative — stopped by time budget, will resume next invocation`,
    });
  }

  return { shopId: account.shop_id, syncedOrders: runSyncedOrders, syncedItems: runSyncedItems, completed: reachedEnd };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth gate: verify_jwt at the platform level already rejects any request
  // without a valid Supabase JWT before this code runs — this block only
  // decides what a *valid* JWT is allowed to do.
  //   - role "authenticated" = a logged-in ERP user's session JWT
  //     (supabaseClient.functions.invoke() attaches it automatically, no
  //     frontend change needed) -> let it straight through.
  //   - role "anon" = cron's anon-key JWT -> must additionally present a
  //     matching x-sync-secret header.
  //   - anything else (service_role, malformed/missing JWT) -> rejected.
  function jwtRole(authHeader: string | null): string | undefined {
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    const payload = token?.split(".")[1];
    if (!payload) return undefined;
    try {
      return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")))?.role;
    } catch {
      return undefined;
    }
  }

  const role = jwtRole(req.headers.get("Authorization"));
  const requiredSecret = Deno.env.get("SYNC_TRIGGER_SECRET");
  let authorized: boolean;
  if (role === "authenticated") {
    authorized = true;
  } else if (role === "anon") {
    authorized = !!requiredSecret && req.headers.get("x-sync-secret") === requiredSecret;
  } else {
    authorized = false;
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let creds;
  try {
    creds = requireShopeeCredentials();
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let shopId: string | undefined;
  let platformAccountId: string | undefined;
  let orderSns: string[] | undefined;
  try {
    const body = await req.json();
    platformAccountId = body?.platformAccountId; // preferred — platform_accounts.id, unambiguous per store
    shopId = body?.shopId; // kept for backward compat
    orderSns = Array.isArray(body?.orderSns) ? body.orderSns : undefined;
  } catch {
    // no body / not JSON - sync all shops
  }

  let query = supabase
    .from("platform_accounts")
    .select("id, platform, shop_id, access_token, refresh_token, token_expires_at")
    .eq("platform", "shopee")
    .eq("status", "connected")
    .not("access_token", "is", null);
  if (platformAccountId) query = query.eq("id", platformAccountId);
  else if (shopId) query = query.eq("shop_id", shopId);

  const { data: accounts, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!accounts || accounts.length === 0) {
    return new Response(JSON.stringify({ error: "No connected Shopee shop with a saved access_token found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Targeted resync (2026-08-20, new) — explicit orderSns list, bypasses the
  // incremental time-window scan/checkpoint entirely, reuses
  // upsertShopeeOrderBatch directly. Requires platformAccountId or shopId so
  // there's exactly one account to resolve the token against.
  if (orderSns && orderSns.length > 0) {
    const account = accounts[0];
    const accessToken = await refreshTokenIfNeeded(creds, account);
    try {
      const result = await upsertShopeeOrderBatch(creds, account, accessToken, orderSns);
      return new Response(JSON.stringify({ targeted: true, shopId: account.shop_id, ...result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const results = [];
  for (const account of accounts) {
    try {
      results.push(await syncOneShop(creds, account));
    } catch (e) {
      await supabase.from("sync_logs").insert({
        action: "shopee_sync_shop",
        status: "failed",
        message: `shop ${account.shop_id}: ${(e as Error).message}`,
      });
      results.push({ shopId: account.shop_id, error: (e as Error).message });
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
