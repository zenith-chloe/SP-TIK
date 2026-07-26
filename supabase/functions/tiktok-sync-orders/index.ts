// Pulls recent orders from TikTok Shop for one (or all) connected shop(s) and
// upserts them into `orders` / `order_items`.
//
// Body (optional): { "shopId": "..." }  -- omit to sync all connected shops
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

async function syncOneShop(
  creds: TikTokCredentials,
  account: { id: string; shop_id: string; access_token: string; shop_cipher: string | null },
) {
  const { shopCipher } = await ensureShopCipher(creds, account);

  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  const searchData = await tiktokCall(
    "POST",
    "/order/202309/orders/search",
    creds,
    account.access_token,
    { shop_cipher: shopCipher, page_size: "50", sort_field: "create_time", sort_order: "DESC" },
    { create_time_ge: thirtyDaysAgo },
  );

  const orders = searchData.orders ?? [];
  let syncedOrders = 0;
  let syncedItems = 0;

  for (const o of orders) {
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

    for (const item of o.line_items ?? []) {
      const { error: itemErr } = await supabase.from("order_items").upsert(
        {
          order_id: orderRow.id,
          sku: item.seller_sku || item.sku_id || String(item.id),
          product_name: item.product_name,
          variation: item.sku_name ?? null,
          qty: 1,
          unit_price: Number(item.sale_price ?? 0),
          subtotal: Number(item.sale_price ?? 0),
          image_url: item.sku_image ?? null,
        },
        { onConflict: "order_id,sku" },
      );
      if (!itemErr) syncedItems++;
    }
  }

  await supabase.from("platform_accounts").update({ last_synced_at: new Date().toISOString() }).eq("id", account.id);
  await supabase.from("sync_logs").insert({
    action: "tiktok_sync_shop",
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
    creds = requireTikTokCredentials();
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
    // no body - sync all shops
  }

  let query = supabase
    .from("platform_accounts")
    .select("id, shop_id, access_token, shop_cipher")
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
      results.push(await syncOneShop(creds, account));
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
