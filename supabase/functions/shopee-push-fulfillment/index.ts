// Pushes ERP fulfillment (warehouse_stage -> ready_ship) outbound to
// Shopee via ship_order, so a real Shopee order actually gets marked
// shipped on Shopee's side. Called fire-and-forget from markPacked() in
// the frontend when an order's warehouse_stage transitions to ready_ship.
//
// Scope (approved 2026-08-11, Phase 2): Shopee ship_order pushback only.
// Does NOT touch shopee-sync-orders, syncOneShop, platform_sync_progress,
// any schema, order_status mapping, or TikTok in any way — this is a
// separate, standalone function.
//
// Body: { orderId: string }  (orders.id, uuid)
//
// Idempotency: no new table/column. Before calling Shopee, checks the
// existing sync_logs table for a prior successful shopee_push_fulfillment
// row for this order_no — if found, skips. sync_logs is also the only
// table this function ever writes to, per scope.
//
// Required secrets: SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY, SHOPEE_ENV
// (same secrets already used by shopee-sync-orders; read-only here, not
// modified or re-defined).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireShopeeCredentials, shopeeHost, signRequest, type ShopeeCredentials } from "./shopee.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function shopeePost(
  path: string,
  creds: ShopeeCredentials,
  shopId: string,
  accessToken: string,
  body: Record<string, unknown>,
) {
  const { timestamp, sign } = await signRequest(path, creds, { shopId, accessToken });
  const url = new URL(`${shopeeHost()}${path}`);
  url.searchParams.set("partner_id", creds.partnerId);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);
  url.searchParams.set("shop_id", shopId);
  url.searchParams.set("access_token", accessToken);

  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // Read as text first — Shopee occasionally returns a non-JSON body (HTML
  // error page, empty body, etc.) on outages/rate limits. Parsing that
  // directly with resp.json() throws an opaque "Unexpected token" error that
  // gives no clue what actually went wrong; this turns it into a clear,
  // diagnosable error message instead (still caught by the caller's existing
  // try/catch and logged to sync_logs exactly as before).
  const raw = await resp.text();
  let data: Record<string, unknown>;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`${path} failed: non-JSON response (status ${resp.status}): ${raw.slice(0, 200)}`);
  }
  if (!resp.ok || data.error) {
    throw new Error(`${path} failed: ${data.error ?? resp.status} ${data.message ?? ""}`);
  }
  return data;
}

// get_shipping_parameter is a GET endpoint per Shopee Open API v2 (params in
// the query string, not a JSON body) — using shopeePost's POST against it
// was returning a plain 404 "page not found" from Shopee's gateway, the real
// root cause behind every previously-failed push. ship_order stays on
// shopeePost/POST, which is correct per the same docs.
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
  const raw = await resp.text();
  let data: Record<string, unknown>;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`${path} failed: non-JSON response (status ${resp.status}): ${raw.slice(0, 200)}`);
  }
  if (!resp.ok || data.error) {
    throw new Error(`${path} failed: ${data.error ?? resp.status} ${data.message ?? ""}`);
  }
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let orderId: string | undefined;
  try {
    const body = await req.json();
    orderId = body?.orderId;
  } catch {
    // ignore - handled by the missing-orderId check below
  }
  if (!orderId) {
    return new Response(JSON.stringify({ error: "Missing orderId" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, order_no, platform, platform_account_id, platform_status")
    .eq("id", orderId)
    .maybeSingle();

  if (orderErr || !order) {
    return new Response(JSON.stringify({ error: orderErr?.message ?? "Order not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Only Shopee orders with a real order_no (Shopee's order_sn) to push
  // against — no warehouse_stage requirement (removed 2026-08-11, matches
  // TikTok's production 待发货→确认发货 flow, which doesn't require the
  // internal warehouse pipeline either). Real gate is Shopee's own status:
  // must still be READY_TO_SHIP on Shopee's side, avoiding accidental
  // re-ship calls on already-shipped/cancelled orders.
  if (order.platform !== "shopee" || order.platform_status !== "READY_TO_SHIP" || !order.order_no) {
    return new Response(JSON.stringify({ skipped: true, reason: "not a Shopee order at READY_TO_SHIP" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Idempotency guard: reuse sync_logs as the sole durable record. If a
  // prior successful push already exists for this order_no, skip — no new
  // table/column, and this is a read, not a write.
  const { data: existingLog } = await supabase
    .from("sync_logs")
    .select("id")
    .eq("action", "shopee_push_fulfillment")
    .eq("status", "success")
    .ilike("message", `${order.order_no}:%`)
    .limit(1)
    .maybeSingle();

  if (existingLog) {
    return new Response(JSON.stringify({ skipped: true, reason: "already pushed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: account, error: accountErr } = await supabase
    .from("platform_accounts")
    .select("id, shop_id, access_token")
    .eq("id", order.platform_account_id)
    .maybeSingle();

  if (accountErr || !account || !account.access_token) {
    await supabase.from("sync_logs").insert({
      action: "shopee_push_fulfillment",
      status: "failed",
      message: `${order.order_no}: no connected Shopee account for this order`,
    });
    return new Response(JSON.stringify({ error: "No connected Shopee account" }), {
      status: 404,
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

  try {
    // Step 1: get_shipping_parameter — required before ship_order; the
    // fields it demands vary per order/courier, so nothing here is
    // hardcoded to one specific shipping method. GET per Shopee's docs
    // (2026-08-17 fix — was POST, which Shopee's gateway 404s).
    const paramResp = await shopeeGet(
      "/api/v2/logistics/get_shipping_parameter",
      creds,
      account.shop_id,
      account.access_token,
      { order_sn: order.order_no },
    );

    // Shopee rejects ship_order if more than one of pickup/dropoff/
    // non_integrated is present in the body ("ship_order_only_support_one_
    // type") — mutually exclusive by construction now (2026-08-17 fix, was
    // two independent ifs that could both fire). Checked in this order:
    // pickup first (only if Shopee actually gave us a pickup address to
    // use), then dropoff, else non_integrated (no extra fields needed).
    const shipBody: Record<string, unknown> = { order_sn: order.order_no };
    const infoNeeded = paramResp.response?.info_needed ?? {};
    const firstPickupAddress = paramResp.response?.pickup?.address_list?.[0];
    if (infoNeeded.pickup && firstPickupAddress) {
      const pickup: Record<string, unknown> = { address_id: firstPickupAddress.address_id };
      // "Pickup time is out of range" (2026-08-17 real error, order
      // 260817JF134KUH) — confirmed via a one-off debug call that
      // time_slot_list lives INSIDE each address_list entry, not at
      // pickup's top level (that was the bug — always undefined, so
      // pickup_time_id was silently never sent). Picks the first (soonest)
      // available slot for the same address being used — no manual time
      // selection exists in this ERP flow.
      const firstSlot = firstPickupAddress.time_slot_list?.[0];
      if (firstSlot?.pickup_time_id) pickup.pickup_time_id = firstSlot.pickup_time_id;
      shipBody.pickup = pickup;
    } else if (infoNeeded.dropoff) {
      shipBody.dropoff = paramResp.response?.dropoff ?? {};
    }

    // Step 2: ship_order — the actual pushback.
    const shipResp = await shopeePost(
      "/api/v2/logistics/ship_order",
      creds,
      account.shop_id,
      account.access_token,
      shipBody,
    );

    const trackingNo = shipResp.response?.tracking_number ?? null;

    // Explicitly authorized 2026-08-17: advance platform_status to Shopee's
    // real next lifecycle value (same "PROCESSED" string mapDbOrder/
    // mapShopeeOrderStatus already treat as the post-ship_order state) so
    // the ERP reflects the shipment immediately instead of waiting up to a
    // minute for the next cron sync to pull it back from Shopee. The next
    // cron run still re-syncs the true value from Shopee's API regardless,
    // so this is a display-latency fix, not a new source of truth — cron
    // always wins if Shopee's real status differs.
    const { error: statusErr } = await supabase
      .from("orders")
      .update({ platform_status: "PROCESSED" })
      .eq("id", order.id);
    if (statusErr) {
      await supabase.from("sync_logs").insert({
        action: "shopee_push_fulfillment",
        status: "failed",
        message: `${order.order_no}: ship_order succeeded but platform_status update failed - ${statusErr.message}`,
      });
    }

    await supabase.from("sync_logs").insert({
      action: "shopee_push_fulfillment",
      status: "success",
      message: `${order.order_no}: ship_order succeeded${trackingNo ? `, tracking_no ${trackingNo}` : ""}`,
    });

    return new Response(JSON.stringify({ success: true, trackingNo, platformStatus: "PROCESSED" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    await supabase.from("sync_logs").insert({
      action: "shopee_push_fulfillment",
      status: "failed",
      message: `${order.order_no}: ${(e as Error).message}`,
    });
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
