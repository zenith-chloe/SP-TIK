// Pulls real Shopee Return/Refund data (get_return_list + get_return_detail)
// for every connected Shopee shop and upserts it into `shopee_returns`.
// Standalone from shopee-sync-orders — never reads/writes `orders`,
// `order_items`, `products`, `inventory`, or the shopee-sync-orders-
// incremental cron/checkpoint state. Does not touch order_status.
//
// Body (optional): { "platformAccountId": "..." } — sync one shop only.
// Omit to sync all connected Shopee shops (same convention as
// shopee-sync-orders/shopee-settlement-sync).
//
// Optional secret SYNC_TRIGGER_SECRET: same auth gate as shopee-sync-orders
// (authenticated ERP session OR anon + matching x-sync-secret header, for
// the cron caller).
//
// Required secrets: SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY, SHOPEE_ENV (same
// secrets every other shopee-* function already uses, read-only here).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// Pinned to an exact, verified-published version (not the floating "@2" tag)
// — "@2" was resolving to today's npm "latest" (2.117.1), and Supabase's
// bundler failed 3/3 times trying to cache that version's own sub-package
// tarballs (@supabase/storage-js, @supabase/functions-js), a registry-side
// issue, not anything in this file. 2.45.4 confirmed to exist on the npm
// registry with normal, already-published sub-dependency versions
// (storage-js 2.7.0 / functions-js 2.4.1 / postgrest-js 1.16.1) — same
// createClient API surface this function actually uses (.from().select/
// upsert/update only), so no behavior change from the version pin itself.
import { createClient } from "jsr:@supabase/supabase-js@2.45.4";
import {
  requireShopeeCredentials,
  shopeeHost,
  signRequest,
  type ShopeeCredentials,
} from "./shopee.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Shopee's Return List API caps the create_time/update_time range at 15
// days per call (same limit documented for get_order_list-style endpoints
// in this codebase already) — a 15-day rolling window every 2-minute
// invocation comfortably re-covers any return whose status changed since
// the last run without needing a separate checkpoint table (returns volume
// is far lower than order volume, so no resumable multi-page state machine
// like shopee-sync-orders' platform_sync_progress is needed here).
const WINDOW_DAYS = 15;
const MAX_PAGES_PER_SHOP = 20; // safety cap, mirrors shopee-settlement-sync's BATCH_SIZE-style guard
const PAGE_SIZE = 50;

// Copied verbatim from shopee-sync-orders/index.ts (same per-function-copy
// convention as the rest of this codebase) — reuses the exact same token
// refresh mechanism, does not modify platform_accounts beyond the token
// fields it already owns.
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

// Diagnostic-only variant of the get_return_list call, used ONLY to
// investigate why return_list has come back empty — does not throw on a
// Shopee functional error (data.error) until AFTER the raw shape has been
// captured and logged, so a real cause (bad param, empty result, missing
// scope) is visible in sync_logs instead of being collapsed into a generic
// thrown Error message. Never includes access_token/refresh_token/
// partner_key/sign/timestamp/partner_id in what gets logged — only the
// non-secret query params this function actually controls.
async function shopeeGetReturnListDiagnostic(
  creds: ShopeeCredentials,
  shopId: string,
  accessToken: string,
  params: { page_no: string; page_size: string; update_time_from: string; update_time_to: string },
) {
  const path = "/api/v2/returns/get_return_list";
  const { timestamp, sign } = await signRequest(path, creds, { shopId, accessToken });
  const url = new URL(`${shopeeHost()}${path}`);
  url.searchParams.set("partner_id", creds.partnerId);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);
  url.searchParams.set("shop_id", shopId);
  url.searchParams.set("access_token", accessToken);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const resp = await fetch(url.toString());
  const raw = await resp.text();
  let data: Record<string, unknown>;
  let parseError: string | null = null;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
    parseError = raw.slice(0, 300);
  }
  const responseObj = (data.response ?? {}) as Record<string, unknown>;
  // Confirmed live 2026-09-23 against both real connected Shopee shops: the
  // real field is `response.return` (singular), not `return_list` — the
  // earlier version of this function read the wrong key and always got an
  // empty array back regardless of whether Shopee actually had data. There
  // is no `total_count` field in the real response either, so it is no
  // longer read/logged.
  const returnList = (responseObj.return as unknown[] | undefined) ?? [];

  await supabase.from("sync_logs").insert({
    action: "shopee_returns_diagnostic",
    status: "success",
    message: JSON.stringify({
      shop_id: shopId,
      request: {
        page_no: params.page_no,
        page_size: params.page_size,
        update_time_from: params.update_time_from,
        update_time_to: params.update_time_to,
        status: null, // not passed by this code — recorded explicitly per instruction
      },
      response: {
        http_status: resp.status,
        error: data.error ?? null,
        message: data.message ?? null,
        request_id: data.request_id ?? null,
        return_count: returnList.length,
        more: responseObj.more ?? null,
        // Kept for one more pass in case `return` items themselves use
        // field names other than return_sn — this prints the first raw
        // item's own keys/values so a mismatch there is equally provable,
        // not guessed.
        first_return_item_raw: returnList[0] ?? null,
        response_top_level_keys: Object.keys(data),
        response_object_keys: Object.keys(responseObj),
        parse_error: parseError,
      },
    }),
  });

  return { resp, data, responseObj, returnList };
}

async function syncOneShop(
  creds: ShopeeCredentials,
  account: { id: string; shop_id: string; access_token: string; refresh_token: string; token_expires_at: string },
): Promise<{ shopId: string; syncedReturns: number; error?: string }> {
  const accessToken = await refreshTokenIfNeeded(creds, account);

  const now = Math.floor(Date.now() / 1000);
  const windowFrom = now - WINDOW_DAYS * 24 * 60 * 60;
  const windowTo = now;

  const returnSns: string[] = [];
  let cursor = 0; // Returns API pages by page_no (0-indexed), not a cursor token
  let more = true;
  let pages = 0;

  while (more && pages < MAX_PAGES_PER_SHOP) {
    const params = {
      page_no: String(cursor),
      page_size: String(PAGE_SIZE),
      update_time_from: String(windowFrom),
      update_time_to: String(windowTo),
    };
    const { resp, data, responseObj, returnList: rawReturnList } = await shopeeGetReturnListDiagnostic(
      creds,
      account.shop_id,
      accessToken,
      params,
    );
    // Preserve the original error semantics (throw → caught by the caller,
    // logged, shop marked failed) — the diagnostic log above has already
    // captured the raw shape regardless of this outcome.
    if (!resp.ok || data.error) {
      throw new Error(`get_return_list failed: ${data.error ?? resp.status} ${data.message ?? ""}`);
    }
    // deno-lint-ignore no-explicit-any
    const returnList = rawReturnList as Array<any>;
    for (const r of returnList) {
      if (r.return_sn) returnSns.push(r.return_sn);
    }
    more = !!responseObj.more;
    cursor += 1;
    pages += 1;
  }

  if (returnSns.length === 0) {
    return { shopId: account.shop_id, syncedReturns: 0 };
  }

  // Resolve order_id for each return's order_no in one batch lookup —
  // read-only against `orders`, never written to.
  let synced = 0;
  for (const returnSn of returnSns) {
    try {
      const detailResp = await shopeeGet("/api/v2/returns/get_return_detail", creds, account.shop_id, accessToken, {
        return_sn: returnSn,
      });
      // deno-lint-ignore no-explicit-any
      const d = (detailResp.response as any) ?? {};
      const orderSn: string | undefined = d.order_sn ?? d.order_id ?? undefined;

      let orderId: string | null = null;
      if (orderSn) {
        const { data: orderRow } = await supabase
          .from("orders")
          .select("id")
          .eq("platform", "shopee")
          .eq("order_no", orderSn)
          .maybeSingle();
        orderId = orderRow?.id ?? null;
      }

      const { error: upsertErr } = await supabase.from("shopee_returns").upsert(
        {
          platform_account_id: account.id,
          shop_id: account.shop_id,
          return_sn: returnSn,
          order_no: orderSn ?? "",
          order_id: orderId,
          status: d.status ?? null,
          refund_amount: d.refund_amount ?? null,
          reason: d.reason ?? null,
          negotiation_status: d.negotiation_status ?? null,
          create_time: d.create_time ? new Date(d.create_time * 1000).toISOString() : null,
          update_time: d.update_time ? new Date(d.update_time * 1000).toISOString() : null,
          raw: detailResp,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "platform_account_id,return_sn" },
      );
      if (upsertErr) {
        await supabase.from("sync_logs").insert({
          action: "shopee_returns_sync",
          status: "failed",
          message: `shop ${account.shop_id} return ${returnSn}: db error ${upsertErr.message}`,
        });
        continue;
      }
      synced++;
    } catch (e) {
      await supabase.from("sync_logs").insert({
        action: "shopee_returns_sync",
        status: "failed",
        message: `shop ${account.shop_id} return ${returnSn}: ${(e as Error).message}`,
      });
    }
  }

  return { shopId: account.shop_id, syncedReturns: synced };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth gate: identical pattern to shopee-sync-orders/index.ts.
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

  let platformAccountId: string | undefined;
  try {
    const body = await req.json();
    platformAccountId = body?.platformAccountId;
  } catch {
    // no body - sync all connected shops
  }

  let query = supabase
    .from("platform_accounts")
    .select("id, platform, shop_id, access_token, refresh_token, token_expires_at")
    .eq("platform", "shopee")
    .eq("status", "connected")
    .not("access_token", "is", null);
  if (platformAccountId) query = query.eq("id", platformAccountId);

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

  const results = [];
  let totalSynced = 0;
  for (const account of accounts) {
    try {
      const r = await syncOneShop(creds, account);
      results.push(r);
      totalSynced += r.syncedReturns;
    } catch (e) {
      await supabase.from("sync_logs").insert({
        action: "shopee_returns_sync",
        status: "failed",
        message: `shop ${account.shop_id}: ${(e as Error).message}`,
      });
      results.push({ shopId: account.shop_id, syncedReturns: 0, error: (e as Error).message });
    }
  }

  await supabase.from("sync_logs").insert({
    action: "shopee_returns_sync",
    status: totalSynced > 0 || results.every((r) => !r.error) ? "success" : "failed",
    message: `synced ${totalSynced} returns across ${accounts.length} shop(s): ${JSON.stringify(results)}`,
  });

  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
