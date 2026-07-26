// Pulls recent orders from Shopee for one (or all) connected shop(s) and
// upserts them into `orders` / `order_items`. Call this from a button in the
// frontend, or wire it to a cron schedule later.
//
// Body (optional): { "shopId": "123456" }  -- omit to sync all connected shops
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

async function syncOneShop(creds: ShopeeCredentials, account: {
  id: string;
  shop_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
}) {
  const accessToken = await refreshTokenIfNeeded(creds, account);

  const now = Math.floor(Date.now() / 1000);
  const fifteenDaysAgo = now - 15 * 24 * 60 * 60;

  const listResp = await shopeeGet("/api/v2/order/get_order_list", creds, account.shop_id, accessToken, {
    time_range_field: "update_time",
    time_from: String(fifteenDaysAgo),
    time_to: String(now),
    page_size: "50",
  });

  const orderSns: string[] = (listResp.response?.order_list ?? []).map((o: { order_sn: string }) => o.order_sn);
  let syncedOrders = 0;
  let syncedItems = 0;

  for (let i = 0; i < orderSns.length; i += 50) {
    const batch = orderSns.slice(i, i + 50);
    if (batch.length === 0) continue;

    const detailResp = await shopeeGet("/api/v2/order/get_order_detail", creds, account.shop_id, accessToken, {
      order_sn_list: batch.join(","),
      response_optional_fields: "item_list,recipient_address,total_amount,shipping_carrier,order_status,cod",
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

      // If the same SKU appears in more than one item_list entry on this order
      // (e.g. distinct order lines that resolve to the same override SKU),
      // sum them here first — otherwise the order_items upsert (keyed on
      // order_id+sku) would overwrite instead of accumulate, and the
      // stock_movements idempotency guard would skip the deduction for every
      // entry after the first, under-deducting stock.
      const itemsBySku = new Map<string, { productName: string; variation: string | null; qty: number; subtotal: number; imageUrl: string | null }>();
      for (const item of o.item_list ?? []) {
        const sku = item.model_sku || item.item_sku || String(item.item_id);
        const qty = item.model_quantity_purchased ?? 1;
        const unitPrice = item.model_discounted_price ?? item.model_original_price ?? 0;
        const subtotal = unitPrice * qty;
        const existing = itemsBySku.get(sku);
        if (existing) {
          existing.qty += qty;
          existing.subtotal += subtotal;
        } else {
          itemsBySku.set(sku, {
            productName: item.item_name,
            variation: item.model_name ?? null,
            qty,
            subtotal,
            imageUrl: item.image_info?.image_url ?? null,
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
            unit_price: grouped.qty > 0 ? grouped.subtotal / grouped.qty : 0,
            subtotal: grouped.subtotal,
            image_url: grouped.imageUrl,
          },
          { onConflict: "order_id,sku" },
        );
        if (!itemErr) {
          syncedItems++;
          await deductStockForItem(orderRow.id, sku, grouped.qty, "shopee", mapShopeeOrderStatus(o.order_status), o.order_status ?? null);
        }
      }
    }
  }

  await supabase
    .from("platform_accounts")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", account.id);

  await supabase.from("sync_logs").insert({
    action: "shopee_sync_shop",
    status: "success",
    message: `shop ${account.shop_id}: ${syncedOrders} orders, ${syncedItems} items`,
  });

  return { shopId: account.shop_id, syncedOrders, syncedItems };
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
    creds = requireShopeeCredentials();
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let shopId: string | undefined;
  try {
    const body = await req.json();
    shopId = body?.shopId;
  } catch {
    // no body / not JSON - sync all shops
  }

  let query = supabase
    .from("platform_accounts")
    .select("id, shop_id, access_token, refresh_token, token_expires_at")
    .eq("platform", "shopee")
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
    return new Response(JSON.stringify({ error: "No connected Shopee shop with a saved access_token found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
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
    headers: { "Content-Type": "application/json" },
  });
});
