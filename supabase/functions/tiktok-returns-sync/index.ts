// Standalone TikTok Return & Refund sync — completely separate from
// tiktok-sync-orders (own file, own copy of signing helpers, own table
// `tiktok_returns`). Never writes to `orders`, never touches order_status/
// platform_status, never touches platform_sync_progress/last_synced_at —
// so the existing order sync, its "全部/未付款/已送达/已取消" stat cards,
// and Shopee are all completely unaffected.
//
// Root cause this fixes: TikTok tracks returns/refunds via a domain
// entirely separate from Order Search (confirmed empirically: order_status
// ='returned' has zero real rows, returned_at is null for every synced
// TikTok order, and Shopee's own mapping never produces 'returned' either
// — the data has never existed anywhere in this project). This calls
// TikTok's Return & Refund search API for the first time to actually
// capture it.
//
// Endpoint path (/return_refund/202309/returns/search) is NOT verified
// against live docs (same limitation as tiktok-ship-package-test — the
// docs site requires JS and couldn't be fetched). The first real call's
// response (logged in the JSON return either way) tells us definitively
// whether the path/params are right.
//
// Required secrets: TIKTOK_APP_KEY, TIKTOK_APP_SECRET (same as tiktok-sync-orders)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  API_HOST,
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
}

async function tiktokCall(
  method: "GET" | "POST",
  path: string,
  creds: TikTokCredentials,
  account: TikTokAccount,
  extraQuery: Record<string, string>,
  body?: Record<string, unknown>,
): Promise<{ status: number; code: number; message: string; data: unknown }> {
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

  let body: { platformAccountId?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  let query = supabase
    .from("platform_accounts")
    .select("id, access_token, shop_cipher")
    .eq("platform", "tiktok")
    .eq("status", "connected")
    .not("access_token", "is", null)
    .not("shop_cipher", "is", null);
  if (body.platformAccountId) query = query.eq("id", body.platformAccountId);

  const { data: account } = await query.limit(1).maybeSingle();
  if (!account) {
    return new Response(JSON.stringify({ error: "No connected TikTok account with a resolved shop_cipher found — run a normal sync first" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const result = await tiktokCall(
      "POST",
      "/return_refund/202309/returns/search",
      creds,
      account,
      { shop_cipher: account.shop_cipher, page_size: "50" },
      {},
    );

    if (result.code !== 0) {
      // Surface the raw error untouched — this is the empirical test of
      // whether the endpoint path/params are right, same pattern used to
      // validate tiktok-ship-package-test's Ship Package call.
      return new Response(JSON.stringify({ success: false, status: result.status, code: result.code, message: result.message, data: result.data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // deno-lint-ignore no-explicit-any
    const returns = (result.data as any)?.return_orders ?? (result.data as any)?.returns ?? [];
    let upserted = 0;
    for (const r of returns) {
      // deno-lint-ignore no-explicit-any
      const rr = r as any;
      const returnId = rr.return_id ?? rr.id;
      const orderNo = rr.order_id ?? rr.order_no;
      if (!returnId || !orderNo) continue;
      const { error } = await supabase.from("tiktok_returns").upsert({
        platform_account_id: account.id,
        return_id: String(returnId),
        order_no: String(orderNo),
        return_status: rr.return_status ?? rr.status ?? null,
        create_time: rr.create_time ? new Date(Number(rr.create_time) * 1000).toISOString() : null,
        update_time: rr.update_time ? new Date(Number(rr.update_time) * 1000).toISOString() : null,
        raw: rr,
        synced_at: new Date().toISOString(),
      }, { onConflict: "platform_account_id,return_id" });
      if (!error) upserted++;
    }

    return new Response(JSON.stringify({ success: true, rawCount: returns.length, upserted, sample: returns[0] ?? null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
