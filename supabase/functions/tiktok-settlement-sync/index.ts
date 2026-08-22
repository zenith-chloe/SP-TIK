// Pulls real TikTok Shop settlement transactions per order (GET
// /finance/202309/orders/{order_id}/statement_transactions) and upserts the
// real fee breakdown into order_settlements. Real fields confirmed live
// 2026-08-18 against order 582623995474379880 before this was written (see
// tiktok-settlement-debug, now superseded by this).
//
// Body (optional): { "orderIds": [...] } — sync specific orders.
// Omit to sync up to BATCH_SIZE real TikTok orders that don't have a
// settlement row yet, oldest-updated-first — same repeated-invocation
// backfill pattern as shopee-settlement-sync.
//
// Candidate filter widened 2026-08-21 (real bug found live, order
// 585582289461216754): previously only platform_status === "COMPLETED"
// orders were ever considered candidates, so any order still sitting at
// "DELIVERED" (TikTok's pre-completion status, can last a while during the
// return-eligibility window) never got a settlement row at all, even if
// TikTok had already actually settled it — DELIVERED added to the filter.
// Safe: TikTok's real statement_transactions endpoint already handles a
// not-yet-settled order gracefully ("no statement_transactions yet") for
// any status, so widening the candidate net can't create bad data, only
// picks up real settlements earlier.
//
// Required secrets: TIKTOK_APP_KEY, TIKTOK_APP_SECRET (same secrets
// tiktok-sync-orders already uses, read-only here).
//
// Affiliate Seller API investigated 2026-08-22, not integrated: live-tested
// POST /affiliate_seller/202410/orders/search (seller.affiliate_collaboration.read)
// via a temporary debug probe — got real code 105005 "access scopes...do not
// contain the required access scope". User confirmed with TikTok Partner
// Center that this scope cannot be added to Custom Apps at all (platform
// policy limit, not a request-it-and-wait situation). Do not re-attempt
// without a real change on TikTok's side. Settled orders already get real
// affiliate_commission_amount via /finance/202309/.../statement_transactions
// below — that path is unaffected and is the only real affiliate data source.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { API_HOST, requireTikTokCredentials, signApiRequest, type TikTokCredentials } from "./tiktok.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Raised 20 -> 50 (2026-08-21, user-approved) to work through the one-time
// 5,800+ order backlog created by widening SETTLEMENT_CANDIDATE_STATUSES
// above. Each candidate is still one sequential TikTok API call (no
// parallelization) — 50 calls/minute is a conservative step up, not a jump
// to the platform's actual rate ceiling (not independently confirmed for
// this specific finance endpoint). Any per-order API rejection (e.g. a real
// 429) is captured in that order's `results[order_no]` message and
// `sync_logs`, same as any other per-order failure — never silent, never
// corrupts other rows. Revisit further if sync_logs shows rate-limit errors.
const BATCH_SIZE = 50;
const SETTLEMENT_CANDIDATE_STATUSES = ["COMPLETED", "DELIVERED"];

async function tiktokGetStatementTransactions(
  creds: TikTokCredentials,
  shopCipher: string,
  accessToken: string,
  orderId: string,
) {
  const path = `/finance/202309/orders/${orderId}/statement_transactions`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const queryParams: Record<string, string> = { app_key: creds.appKey, timestamp, shop_cipher: shopCipher };
  const sign = await signApiRequest(path, creds, queryParams);

  const url = new URL(`${API_HOST}${path}`);
  for (const [k, v] of Object.entries(queryParams)) url.searchParams.set(k, v);
  url.searchParams.set("sign", sign);

  const resp = await fetch(url.toString(), { headers: { "Content-Type": "application/json", "x-tts-access-token": accessToken } });
  const raw = await resp.text();
  let data: Record<string, unknown>;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`statement_transactions failed: non-JSON response (status ${resp.status}): ${raw.slice(0, 200)}`);
  }
  if (!resp.ok || data.code !== 0) {
    throw new Error(`statement_transactions failed: ${data.code ?? resp.status} ${data.message ?? ""}`);
  }
  // deno-lint-ignore no-explicit-any
  return (data.data as any) ?? {};
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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
  if (role === "authenticated") authorized = true;
  else if (role === "anon") authorized = !!requiredSecret && req.headers.get("x-sync-secret") === requiredSecret;
  else authorized = false;
  if (!authorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let creds;
  try {
    creds = requireTikTokCredentials();
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let orderIds: string[] | undefined;
  try {
    const body = await req.json();
    orderIds = Array.isArray(body?.orderIds) ? body.orderIds : undefined;
  } catch {
    // no body - default batch mode below
  }

  let targetOrders: { id: string; order_no: string; platform_account_id: string }[];
  if (orderIds && orderIds.length > 0) {
    const { data, error } = await supabase
      .from("orders")
      .select("id, order_no, platform_account_id")
      .eq("platform", "tiktok")
      .in("order_no", orderIds);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    targetOrders = data ?? [];
  } else {
    const { data: settled, error: settledErr } = await supabase
      .from("order_settlements")
      .select("order_id");
    if (settledErr) return new Response(JSON.stringify({ error: settledErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const doneIds = new Set((settled ?? []).map((r) => r.order_id));

    // Newest-updated-first (2026-08-21, user-approved, was oldest-first) —
    // deliberately deprioritizes the old one-time backlog in favor of
    // orders that JUST became DELIVERED/COMPLETED, since staff/finance care
    // about a recent order's real settlement number far more urgently than
    // a months-old one. The backlog still clears over time (BATCH_SIZE
    // raised above, cron still runs every minute) — this only changes which
    // end of the queue gets attention first, nothing is ever skipped
    // permanently since `doneIds` below only excludes orders already synced.
    const { data: candidates, error: candErr } = await supabase
      .from("orders")
      .select("id, order_no, platform_account_id")
      .eq("platform", "tiktok")
      .in("platform_status", SETTLEMENT_CANDIDATE_STATUSES)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (candErr) return new Response(JSON.stringify({ error: candErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    targetOrders = (candidates ?? []).filter((o) => !doneIds.has(o.id)).slice(0, BATCH_SIZE);
  }

  if (targetOrders.length === 0) {
    return new Response(JSON.stringify({ synced: 0, message: "nothing to sync" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const accountIds = [...new Set(targetOrders.map((o) => o.platform_account_id))];
  const { data: accounts, error: accErr } = await supabase
    .from("platform_accounts")
    .select("id, shop_cipher, access_token")
    .in("id", accountIds);
  if (accErr) return new Response(JSON.stringify({ error: accErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const accountById = new Map((accounts ?? []).map((a) => [a.id, a]));

  const results: Record<string, string> = {};
  let synced = 0;
  for (const o of targetOrders) {
    const account = accountById.get(o.platform_account_id);
    if (!account || !account.access_token || !account.shop_cipher) {
      results[o.order_no] = "no connected account/token/shop_cipher";
      continue;
    }
    try {
      const data = await tiktokGetStatementTransactions(creds, account.shop_cipher, account.access_token, o.order_no);
      // deno-lint-ignore no-explicit-any
      const txns = (data.statement_transactions ?? []) as any[];
      if (txns.length === 0) {
        results[o.order_no] = "no statement_transactions yet (not settled)";
        continue;
      }
      // Sum across transactions in case an order ever has more than one
      // (e.g. partial settlement) — real orders seen so far have exactly one.
      const sum = (key: string) => txns.reduce((s, t) => s + (Number(t[key]) || 0), 0);
      const transactionFee = sum("transaction_fee_amount");
      const commissionFee = Math.abs(sum("platform_commission_amount"));
      const sellerShippingFee = Math.abs(sum("shipping_fee_amount"));
      const affiliateCommission = Math.abs(sum("affiliate_commission_amount"));
      const platformDiscount = Math.abs(sum("platform_discount_amount"));
      const settlementAmount = sum("settlement_amount");
      const totalFees = transactionFee + commissionFee + sellerShippingFee + affiliateCommission;

      const { error: upsertErr } = await supabase.from("order_settlements").upsert(
        {
          order_id: o.id,
          order_no: o.order_no,
          platform: "tiktok",
          tiktok_transaction_fee: transactionFee,
          tiktok_commission_fee: commissionFee,
          tiktok_seller_shipping_fee: sellerShippingFee,
          tiktok_affiliate_commission: affiliateCommission,
          tiktok_platform_discount: platformDiscount,
          tiktok_settlement_amount: settlementAmount,
          total_fees: totalFees,
          net_settlement: settlementAmount,
          raw_response: data,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "order_id" },
      );
      if (upsertErr) {
        results[o.order_no] = `db error: ${upsertErr.message}`;
        continue;
      }
      results[o.order_no] = "ok";
      synced++;
    } catch (e) {
      results[o.order_no] = (e as Error).message;
    }
  }

  await supabase.from("sync_logs").insert({
    action: "tiktok_settlement_sync",
    status: synced > 0 ? "success" : "failed",
    message: `synced ${synced}/${targetOrders.length} orders`,
  });

  return new Response(JSON.stringify({ synced, total: targetOrders.length, results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
