// Standalone, isolated test tool for the TikTok Fulfillment "Ship Package"
// API. Completely separate from tiktok-sync-orders: own file, own copy of
// the signing helpers, own log table (tiktok_ship_test_log). Never writes
// to `orders`, `platform_sync_progress`, or `platform_accounts.last_synced_at`
// — those stay exclusively owned by the real sync function so this tool
// cannot interfere with the existing TikTok -> ERP sync in any way.
//
// Body: { action: "lookup", orderNo } | { action: "ship", orderNo, packageId, shippingProviderId, trackingNumber }
//
// "lookup" is read-only: scans recent orders (search API, no status filter,
// same shape already proven working in tiktok-sync-orders) to find one
// matching order_no, returning its package_id / shipping_provider_id /
// current status so the test page can prefill the ship form.
//
// "ship" calls POST /fulfillment/202309/packages/{package_id}/ship — this
// endpoint path/body shape is NOT yet verified against live TikTok docs
// (docs site requires JS, couldn't be fetched during planning). The first
// real call's response (logged in full either way) tells us definitively
// whether the path/params are right; adjust here if TikTok returns a 404
// or a "missing field" validation error.
//
// Required secrets: TIKTOK_APP_KEY, TIKTOK_APP_SECRET (same as tiktok-sync-orders)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  API_HOST,
  authHost,
  nowTs,
  requireTikTokCredentials,
  signApiRequest,
  type TikTokCredentials,
} from "./tiktok.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface TikTokAccount {
  id: string;
  access_token: string;
  refresh_token: string;
}

// Same refresh-on-105002 behavior as tiktok-sync-orders, duplicated here
// rather than imported so this file has zero code-sharing with the sync
// function's module graph.
async function refreshTikTokToken(creds: TikTokCredentials, account: TikTokAccount) {
  const url = new URL(`${authHost()}/api/v2/token/refresh`);
  url.searchParams.set("app_key", creds.appKey);
  url.searchParams.set("app_secret", creds.appSecret);
  url.searchParams.set("refresh_token", account.refresh_token);
  url.searchParams.set("grant_type", "refresh_token");

  const resp = await fetch(url.toString());
  const payload = await resp.json();
  if (!resp.ok || payload.code !== 0) {
    throw new Error(`token refresh failed: ${payload.code ?? resp.status} ${payload.message ?? ""}`);
  }
  const data = payload.data;
  account.access_token = data.access_token;
  account.refresh_token = data.refresh_token;
  const expiresAt = new Date(Date.now() + (Number(data.access_token_expire_in) || 7200) * 1000).toISOString();
  await supabase.from("platform_accounts").update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_expires_at: expiresAt,
  }).eq("id", account.id);
}

async function tiktokCall(
  method: "GET" | "POST",
  path: string,
  creds: TikTokCredentials,
  account: TikTokAccount,
  extraQuery: Record<string, string>,
  body?: Record<string, unknown>,
): Promise<{ status: number; code: number; message: string; data: unknown }> {
  async function attempt() {
    const timestamp = String(nowTs());
    const queryParams: Record<string, string> = { app_key: creds.appKey, timestamp, ...extraQuery };
    const rawBody = body ? JSON.stringify(body) : "";
    const sign = await signApiRequest(path, creds, queryParams, rawBody);

    const url = new URL(`${API_HOST}${path}`);
    for (const [k, v] of Object.entries(queryParams)) url.searchParams.set(k, v);
    url.searchParams.set("sign", sign);

    const resp = await fetch(url.toString(), {
      method,
      headers: { "Content-Type": "application/json", "x-tts-access-token": account.access_token },
      body: method === "POST" ? rawBody : undefined,
    });
    const payload = await resp.json();
    return { status: resp.status, code: payload.code ?? resp.status, message: payload.message ?? "", data: payload.data };
  }

  const first = await attempt();
  if (first.code === 105002 && account.refresh_token) {
    await refreshTikTokToken(creds, account);
    return await attempt();
  }
  return first;
}

// Read-only: scans recent orders (up to a few pages) looking for one
// matching order_no. Mirrors the query shape already verified live in
// tiktok-sync-orders's incremental branch, just without a time filter.
async function lookupOrder(
  creds: TikTokCredentials,
  account: TikTokAccount & { shop_cipher: string },
  orderNo: string,
) {
  let pageToken: string | undefined;
  const maxPages = 5;
  for (let i = 0; i < maxPages; i++) {
    const query: Record<string, string> = {
      shop_cipher: account.shop_cipher,
      page_size: "50",
      sort_field: "create_time",
      sort_order: "DESC",
    };
    if (pageToken) query.page_token = pageToken;
    const result = await tiktokCall("POST", "/order/202309/orders/search", creds, account, query, {});
    if (result.code !== 0) {
      throw new Error(`order search failed: ${result.code} ${result.message}`);
    }
    // deno-lint-ignore no-explicit-any
    const orders = (result.data as any)?.orders ?? [];
    // deno-lint-ignore no-explicit-any
    const match = orders.find((o: any) => o.id === orderNo);
    if (match) {
      return {
        found: true,
        orderNo: match.id,
        status: match.status,
        packageId: match.packages?.[0]?.id ?? null,
        shippingProviderId: match.shipping_provider_id ?? null,
        shippingProviderName: match.shipping_provider ?? null,
        buyerName: match.recipient_address?.name ?? null,
        totalAmount: match.payment?.total_amount ?? null,
      };
    }
    // deno-lint-ignore no-explicit-any
    pageToken = (result.data as any)?.next_page_token || undefined;
    if (!pageToken) break;
  }
  return { found: false };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let creds: TikTokCredentials;
  try {
    creds = requireTikTokCredentials();
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { action?: string; orderNo?: string; packageId?: string; shippingProviderId?: string; trackingNumber?: string; calledBy?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: account } = await supabase
    .from("platform_accounts")
    .select("id, access_token, refresh_token, shop_cipher")
    .eq("platform", "tiktok")
    .eq("status", "connected")
    .not("access_token", "is", null)
    .not("shop_cipher", "is", null)
    .limit(1)
    .maybeSingle();

  if (!account) {
    return new Response(JSON.stringify({ error: "No connected TikTok account with a resolved shop_cipher found — run a normal sync first" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    if (body.action === "lookup") {
      if (!body.orderNo) throw new Error("orderNo is required");
      const result = await lookupOrder(creds, account, body.orderNo);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "ship") {
      if (!body.orderNo || !body.packageId || !body.shippingProviderId || !body.trackingNumber) {
        throw new Error("orderNo, packageId, shippingProviderId, trackingNumber are all required");
      }
      const requestPayload = {
        tracking_number: body.trackingNumber,
        shipping_provider_id: body.shippingProviderId,
      };
      const shipResult = await tiktokCall(
        "POST",
        `/fulfillment/202309/packages/${body.packageId}/ship`,
        creds,
        account,
        { shop_cipher: account.shop_cipher },
        requestPayload,
      );

      // Re-check the order's status regardless of ship success/failure, so
      // the log always captures whatever TikTok's state actually is.
      let resultOrderStatus: string | null = null;
      try {
        const recheck = await lookupOrder(creds, account, body.orderNo);
        resultOrderStatus = recheck.found ? recheck.status ?? null : null;
      } catch {
        // recheck failure shouldn't hide the ship result itself
      }

      await supabase.from("tiktok_ship_test_log").insert({
        order_no: body.orderNo,
        package_id: body.packageId,
        shipping_provider_id: body.shippingProviderId,
        tracking_number: body.trackingNumber,
        request_payload: requestPayload,
        response_status: shipResult.status,
        response_body: { code: shipResult.code, message: shipResult.message, data: shipResult.data },
        result_order_status: resultOrderStatus,
        called_by: body.calledBy ?? null,
      });

      // TikTok's ship response body carries no order-status field of its own
      // (confirmed live: {code:0, data:{}, message:"Success"}) — the only
      // source for a post-ship status is the lookupOrder recheck above, but
      // that recheck can itself fail/return not-found on TikTok's side
      // (transient, same class of flakiness seen elsewhere this session) and
      // must never be allowed to block writing the known-good outcome of a
      // successful ship call. So: shipResult.code===0 alone is authoritative
      // here — write platform_status="AWAITING_COLLECTION" unconditionally
      // on success; the recheck's resultOrderStatus is logged for visibility
      // only, it cannot veto or override this write. Still never touches
      // order_status or any other column, still never touches
      // platform_sync_progress/last_synced_at.
      if (shipResult.code === 0) {
        await supabase.from("orders").update({
          platform_status: "AWAITING_COLLECTION",
          updated_at: new Date().toISOString(),
        }).eq("platform", "tiktok").eq("order_no", body.orderNo);
      }

      return new Response(JSON.stringify({
        success: shipResult.code === 0,
        status: shipResult.status,
        code: shipResult.code,
        message: shipResult.message,
        data: shipResult.data,
        resultOrderStatus,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "action must be 'lookup' or 'ship'" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
