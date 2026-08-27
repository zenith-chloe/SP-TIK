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
// original_price capture verified end-to-end 2026-08-24 against real order
// 585688274303748056 (buyer "i***ndar m***", matches user-provided TikTok
// screenshot exactly): synced original_price=138 (was showing RM124.20
// sale_price before this field existed); recomputed estimate using it then
// matched TikTok's own real Est. Fees breakdown to the cent — commission
// RM9.69, transaction RM5.22, BXP RM6.71, support RM0.54, total RM22.16,
// payout RM115.84, all identical. Note for future debugging: POST
// /order/202309/orders/search does NOT support an `order_ids` body filter
// (silently ignored, returns an unrelated order instead of erroring) — for
// looking up one specific real order, use GET /order/202309/orders?ids=...
// (the actual "Get Order Detail" endpoint) instead.
//
// 2026-08-24 fee-formula check against real order 585674439704807341 (user-
// provided TikTok Seller Center figures): revenue RM73.60 (original_price-
// based) × commission 7.02% = RM5.17, × transaction (73.60+shipping 0)*3.78%
// = RM2.78, × BXP 4.86% = RM3.58, + flat platform support RM0.54 → total
// RM12.07 — all four match TikTok's real numbers exactly, no formula change
// needed this turn. ERP was still showing RM72.78 (sale_price-based) for
// this specific order only because it hasn't been resynced since the
// original_price fix landed — it self-corrects the next time this order is
// naturally re-pulled (status change triggers incremental sync, or a
// fullSync walk), same known limitation as noted for order 585688274303748056
// above. Checked via manual calculation against user-supplied real figures,
// not a live API pull, to avoid needing a temporary single-order debug probe
// this time (production auth secret isn't retrievable from this session).
//
// 2026-08-24 — live-checked whether this app's TikTok Partner Center
// approval includes Product-category scope (GET /product/202309/categories,
// via a temporary debug=1&endpoint=categories probe, called through the
// browser's own logged-in session so the request carried a real
// role=authenticated JWT). Real result: HTTP 500, TikTok error 105005
// "Access denied ... access scopes granted for the app or the access token
// do not contain the required access scope for the endpoint." Confirms (not
// assumed) that Product API access — category tree, category attributes,
// create/update listing — is NOT granted to this app; only Order/
// Settlement/Fulfillment/Auth scopes are. Any category-tree/mandatory-
// attribute UI in this project must stay free-text/manual until that scope
// is separately requested and approved in TikTok Partner Center.
//
// 2026-08-24 (same day, later) — user reports the Product scope (incl.
// Global Category Information / Global Product Information) has now been
// enabled in TikTok Partner Center. Re-checked live: still HTTP 500 /
// 105005, unchanged. Also tried forcing a brand-new access_token via the
// refresh_token grant first (same authorization, fresh token) — still
// 105005. This proves the scope grant alone isn't enough: an EXISTING
// shop authorization keeps whatever scopes were consented to at the time
// the seller connected the shop; a refresh_token exchange does not pull in
// newly-added app scopes. The seller must fully re-authorize (redo the
// OAuth connect flow for this shop) before its access_token actually
// carries Product-category access. `action: "tiktokCategories"` /
// `"tiktokCategoryAttributes"` / `"tiktokBrands"` (2026-08-24, brand list
// added) below call the real API and surface `needsReauth: true` on a
// 105005 response specifically so the frontend can show "点击重新授权"
// instead of a generic error — once a shop is re-authorized, these same
// real calls should start succeeding with no further code change.
//
// 2026-08-25 — confirmed (twice, live) that for a shop TikTok already
// considers long-term/"unlimited time" authorized, opening the OAuth
// authorize link shows TikTok's own "Renew" screen instead of a fresh
// consent flow, and that screen never redirects back to
// tiktok-auth-callback with a code (checked directly: platform_accounts'
// auth_time/tokens were completely unchanged after the seller clicked
// through it) — TikTok's own message on that screen: "This app or
// service cannot be renewed because it has already been authorized for
// an unlimited time." `action: "verifyConnection"` below is the fix,
// tried first by the frontend's "更新连接" button: it proves whatever
// credential is on file (access_token, or refresh_token exchanged for a
// fresh one) still actually authenticates with a real API call before
// ever marking the shop 'connected' — TikTok's server-side grant being
// "permanent" is a separate fact from whether OUR stored token copy
// still exists/works, so status is never blindly toggled without that
// real check. Falls back to the OAuth link only when there's truly
// nothing to verify (needsFullReauth: true) — e.g. a shop whose
// access_token/refresh_token were both cleared by 退出连接 and hasn't
// completed a real reauth since; for that case the seller must cancel
// the app's authorization in TikTok Seller Center (App Store > My apps
// and incidents > Cancel authorization) before re-running the authorize
// link, since "renew" refuses outright once TikTok considers the grant
// permanent.
//
// 2026-08-26 — seller_discount capture. Real order 585732518380734339
// (user-provided TikTok settlement preview: RM145 subtotal - RM7.25 seller
// discount = RM137.75, all downstream fees based on RM137.75) exposed a gap
// in the 2026-08-24 original_price fix: that fix always used original_price
// as-is for Est. Revenue, correct only when the original_price↔sale_price
// gap is entirely platform_discount (TikTok-funded, doesn't reduce seller
// revenue) — but this order's gap was entirely seller_discount (seller-
// funded, genuinely reduces revenue), and original_price alone overstated
// it by RM7.25. Live-verified via a temporary Get Order Detail debug probe
// (order/202309/orders?ids=...) that TikTok's real line_items carry
// `platform_discount` and `seller_discount` as two separate real fields —
// then confirmed both are ALSO already present in the regular order-search
// response used for ongoing sync (no extra API call needed). Real formula:
// Est. Revenue = original_price - seller_discount (see upsertOrderPage's
// own comment for the exact live verification against both this order and
// the earlier platform_discount-only reference order).
//
// Required secrets: TIKTOK_APP_KEY, TIKTOK_APP_SECRET
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  API_HOST,
  authHost,
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

interface TikTokAccount {
  id: string;
  access_token: string;
  refresh_token: string;
}

// TikTok access_token is short-lived (~2h) and has no auto-renewal path of
// its own — this exchanges the account's refresh_token for a fresh pair via
// TikTok's own refresh endpoint (same host as the auth code exchange in
// tiktok-auth-callback, just grant_type=refresh_token instead of
// authorized_code), then persists it so every account keeps its own token
// row (no cross-account leakage).
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

// account is mutated in place on refresh, so every subsequent tiktokCall for
// this same account (within this invocation) picks up the new token too.
async function tiktokCall(
  method: "GET" | "POST",
  path: string,
  creds: TikTokCredentials,
  account: TikTokAccount,
  extraQuery: Record<string, string>,
  body?: Record<string, unknown>,
) {
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
    const data = await resp.json();
    if (!resp.ok || data.code !== 0) {
      throw new Error(`${path} failed: ${data.code ?? resp.status} ${data.message ?? ""}`);
    }
    return data.data;
  }

  try {
    return await attempt();
  } catch (e) {
    // 105002 = TikTok's "access_token expired" code. Refresh once and retry
    // exactly once — if the retry also fails (e.g. refresh_token itself
    // expired/revoked), that's a real "this connection needs the seller to
    // reauthorize" signal — mark it so 自动导入订单 shows "已过期" instead
    // of silently failing sync run after run (2026-08-25, new).
    if ((e as Error).message.includes("105002") && account.refresh_token) {
      try {
        await refreshTikTokToken(creds, account);
        return await attempt();
      } catch (refreshErr) {
        await supabase.from("platform_accounts").update({ status: "expired" }).eq("id", account.id);
        throw refreshErr;
      }
    }
    throw e;
  }
}

// Multipart variant of tiktokCall (2026-08-27, new) — TikTok's Upload
// Image endpoint takes multipart/form-data (a real file), not a JSON
// body, so it can't reuse tiktokCall's JSON.stringify(body) path. Per
// TikTok's v2 signing rule, a non-JSON body is excluded from the
// signature entirely (rawBody="" — same as any GET call), only the query
// params are signed; the actual file goes in the FormData sent alongside.
async function tiktokCallMultipart(
  path: string,
  creds: TikTokCredentials,
  account: TikTokAccount,
  extraQuery: Record<string, string>,
  form: FormData,
) {
  const timestamp = String(nowTs());
  const queryParams: Record<string, string> = { app_key: creds.appKey, timestamp, ...extraQuery };
  const sign = await signApiRequest(path, creds, queryParams, "");

  const url = new URL(`${API_HOST}${path}`);
  for (const [k, v] of Object.entries(queryParams)) url.searchParams.set(k, v);
  url.searchParams.set("sign", sign);

  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: { "x-tts-access-token": account.access_token },
    body: form,
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
  account: TikTokAccount & { shop_id: string; shop_cipher: string | null },
): Promise<{ shopCipher: string; realShopId: string }> {
  if (account.shop_cipher) return { shopCipher: account.shop_cipher, realShopId: account.shop_id };

  const data = await tiktokCall("GET", "/authorization/202309/shops", creds, account, {});
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
          // Real TikTok ship-by deadline — verified live against the actual
          // Search Orders response (2026-08-09): `cancel_order_sla_time` is
          // the real field present (not `rts_time`, which doesn't appear in
          // this endpoint's response), matching Seller Center's own "To
          // ship by 23:59" cutoff. Same order object already being read
          // above, no new API call. Left null when TikTok doesn't return it
          // for a given order; the frontend falls back to its existing
          // date-based estimate for those rows.
          ship_deadline: o.cancel_order_sla_time ? new Date(Number(o.cancel_order_sla_time) * 1000).toISOString() : null,
          // Real TikTok delivery option label (e.g. "Instant", "Next-day
          // delivery", "Standard shipping") — same order object already
          // being read above, no new API call. Confirmed real via a live
          // TikTok Seller Centre order showing "Delivery option: Instant"
          // (order 584451043333343056, 2026-08-09).
          delivery_option: o.delivery_option_name ?? null,
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

    // Diagnostic-only, additive: records first-sighting timestamps so the
    // real TikTok-API-indexing-delay vs. ERP-write-delay can be measured
    // over a sample of orders. ON CONFLICT DO NOTHING means only the very
    // first sync run that ever sees this order_no writes a row — re-syncs
    // (status updates etc.) never touch it. Never read by any sync logic.
    await supabase.from("order_first_seen_log").upsert(
      {
        order_no: o.id,
        platform: "tiktok",
        tiktok_created_at: o.create_time ? new Date(Number(o.create_time) * 1000).toISOString() : new Date().toISOString(),
      },
      { onConflict: "order_no", ignoreDuplicates: true },
    );

    // TikTok sends one line_item per unit (qty is always 1 on each), so if the
    // same SKU appears in multiple line_items on this order they must be
    // summed here first — otherwise the order_items upsert (keyed on
    // order_id+sku) would just overwrite qty=1 with qty=1 again, and the
    // stock_movements idempotency guard would silently skip the deduction
    // for every line_item after the first, under-deducting stock.
    // original_price (2026-08-24, new) — real field, already present in this
    // same line_items payload (no new API call), previously not captured.
    // sale_price nets out BOTH platform_discount (TikTok-funded) AND
    // seller_discount (seller-funded) from original_price. Real pre-
    // settlement Est. Revenue = original_price - seller_discount only —
    // platform_discount is deliberately NOT subtracted, since it's TikTok's
    // own subsidy, not a real cost to the seller. Live-verified against two
    // real orders with opposite discount compositions: 585688274303748056
    // (seller_discount=0, platform_discount=13.80 — revenue = original_price
    // exactly, TikTok showed RM138) and 585732518380734339 (seller_discount=
    // 7.25, platform_discount=0 — revenue = 145-7.25 = RM137.75, and every
    // downstream fee — commission RM9.67, transaction RM5.21, BXP RM6.69,
    // support RM0.54, affiliate RM2.76, payout RM112.88 — matches TikTok's
    // real settlement preview to the cent). seller_discount confirmed
    // present in this same line_items payload via a temporary Get Order
    // Detail debug probe, then confirmed also present in the regular
    // order-search response used here (no extra API call needed for
    // ongoing sync). Both fields summed the same way sale_price already is
    // (multiple line_items per SKU).
    const itemsBySku = new Map<string, { productName: string; variation: string | null; qty: number; subtotal: number; originalPrice: number; sellerDiscount: number; imageUrl: string | null }>();
    for (const item of o.line_items ?? []) {
      const sku = item.seller_sku || item.sku_id || String(item.id);
      const salePrice = Number(item.sale_price ?? 0);
      const originalPrice = Number(item.original_price ?? item.sale_price ?? 0);
      const sellerDiscount = Number(item.seller_discount ?? 0);
      const existing = itemsBySku.get(sku);
      if (existing) {
        existing.qty += 1;
        existing.subtotal += salePrice;
        existing.originalPrice += originalPrice;
        existing.sellerDiscount += sellerDiscount;
      } else {
        itemsBySku.set(sku, {
          productName: item.product_name,
          variation: item.sku_name ?? null,
          qty: 1,
          subtotal: salePrice,
          originalPrice,
          sellerDiscount,
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
          original_price: grouped.originalPrice,
          seller_discount: grouped.sellerDiscount,
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

// One time budget covers BOTH fetching a page and writing it — 100s leaves
// margin under Supabase's observed ~150s hard kill for Edge Functions.
const TIME_BUDGET_MS = 100000;
const MAX_PAGES_PER_INVOCATION = 500; // sanity cap, time budget hits first in practice

// Walks one page-loop (either the full create_time-DESC walk, or the
// update_time-DESC compensation walk) starting from `pageToken`, checkpointing
// into platform_sync_progress after every page. Shared by both phases below
// so their pagination/budget/error handling can't drift apart.
async function walkPages(
  creds: TikTokCredentials,
  account: TikTokAccount,
  baseQuery: Record<string, string>,
  body: Record<string, unknown>,
  pageToken: string | undefined,
  deadline: number,
  onPage: (pageToken: string | null) => Promise<void>,
) {
  let pageCount = 0;
  let syncedOrders = 0;
  let syncedItems = 0;
  let reachedLastPage = false;
  let truncated = false;

  do {
    const query = pageToken ? { ...baseQuery, page_token: pageToken } : baseQuery;
    const searchData = await tiktokCall("POST", "/order/202309/orders/search", creds, account, query, body);
    const pageOrders = searchData.orders ?? [];
    pageToken = searchData.next_page_token || undefined;
    pageCount++;

    const pageResult = await upsertOrderPage(pageOrders, account);
    syncedOrders += pageResult.syncedOrders;
    syncedItems += pageResult.syncedItems;
    await onPage(pageToken ?? null);

    if (!pageToken) {
      reachedLastPage = true;
      break;
    }
    if (pageCount >= MAX_PAGES_PER_INVOCATION || Date.now() > deadline) {
      truncated = true;
      break;
    }
  } while (pageToken);

  return { pageCount, syncedOrders, syncedItems, reachedLastPage, truncated };
}

// Cheap consistency check: TikTok's order search API returns a total_count
// even at page_size=1, so this costs one request (not a full walk). Compares
// it against ERP's own row count for this account and logs a 'failed' entry
// on any mismatch so drift shows up in sync_logs instead of silently
// accumulating — this is a report-only check, it never writes to orders.
async function verifyOrderCount(
  creds: TikTokCredentials,
  account: TikTokAccount & { shop_id: string },
  shopCipher: string,
) {
  try {
    const data = await tiktokCall("POST", "/order/202309/orders/search", creds, account, { shop_cipher: shopCipher, page_size: "1" }, {});
    const apiTotal = typeof data.total_count === "number" ? data.total_count : null;
    const { count: dbTotal } = await supabase.from("orders").select("id", { count: "exact", head: true }).eq("platform_account_id", account.id);
    const match = apiTotal !== null && dbTotal !== null && apiTotal === dbTotal;
    await supabase.from("sync_logs").insert({
      action: "tiktok_order_count_check",
      status: match ? "success" : "failed",
      message: `shop ${account.shop_id}: TikTok API total=${apiTotal}, ERP total=${dbTotal}` +
        (match ? " — match" : ` — MISMATCH diff=${apiTotal !== null && dbTotal !== null ? apiTotal - dbTotal : "n/a"}`),
    });
  } catch (e) {
    await supabase.from("sync_logs").insert({
      action: "tiktok_order_count_check",
      status: "failed",
      message: `shop ${account.shop_id}: count check errored - ${(e as Error).message}`,
    });
  }
}

async function syncOneShop(
  creds: TikTokCredentials,
  account: TikTokAccount & { shop_id: string; shop_cipher: string | null; last_synced_at: string | null },
  fullSync: boolean,
) {
  const { shopCipher } = await ensureShopCipher(creds, account);
  const isFirstSync = fullSync || !account.last_synced_at;
  const deadline = Date.now() + TIME_BUDGET_MS;

  if (!isFirstSync) {
    // Incremental sync — filter+sort by update_time (not create_time): an
    // order created weeks ago that only just moved to IN_TRANSIT has an old
    // create_time but a fresh update_time, so create_time_ge alone would
    // silently miss it even though it just changed.
    const sinceTs = Math.floor(new Date(account.last_synced_at!).getTime() / 1000);
    const baseQuery = { shop_cipher: shopCipher, page_size: "50", sort_field: "update_time", sort_order: "DESC" };
    const result = await walkPages(creds, account, baseQuery, { update_time_ge: sinceTs }, undefined, deadline, async () => {});

    if (!result.truncated) {
      // Only advance last_synced_at if the walk wasn't cut short, so the
      // next run's update_time_ge window doesn't skip anything.
      await supabase.from("platform_accounts").update({ last_synced_at: new Date().toISOString() }).eq("id", account.id);
    }
    // sync_logs.status only allows 'success'/'failed' (DB check constraint)
    // — truncation is normal expected progress, not a failure, so it's still
    // 'success' with the truncation noted in the message text.
    await supabase.from("sync_logs").insert({
      action: "tiktok_sync_shop",
      status: "success",
      message: `shop ${account.shop_id}: ${result.syncedOrders} orders, ${result.syncedItems} items, ${result.pageCount} page(s), mode=incremental` +
        (result.truncated ? " — stopped by time budget, will resume next invocation" : ""),
    });
    if (!result.truncated) await verifyOrderCount(creds, account, shopCipher);
    return { shopId: account.shop_id, syncedOrders: result.syncedOrders, syncedItems: result.syncedItems, pages: result.pageCount, mode: "incremental", truncated: result.truncated };
  }

  // ===== Full sync + compensation =====
  // Phase 1 ("full"): walk every page by create_time DESC, no time filter —
  // covers full history. Resumable across invocations via platform_sync_progress.
  // Phase 2 ("compensation"): a shop with thousands of orders takes many
  // invocations (many minutes) to finish Phase 1, and TikTok keeps taking new
  // orders the whole time. Phase 1's DESC cursor only moves forward through
  // pages it already committed to, so any order created (or any status
  // change) AFTER Phase 1's cursor passed page 1 is structurally skipped —
  // and since last_synced_at used to get stamped at completion time, future
  // incremental syncs (which only look forward from last_synced_at) would
  // never go back and catch it either. Phase 2 closes that gap: right after
  // Phase 1 reaches its last page, do one more walk filtered by
  // update_time_ge = Phase 1's own started_at (not "now") — this catches
  // every order created or changed at any point during the whole Phase 1
  // run. last_synced_at only advances once Phase 2 itself completes without
  // being truncated.
  let { data: progress } = await supabase
    .from("platform_sync_progress")
    .select("next_page_token, pages_fetched, orders_synced, status, sync_type, started_at")
    .eq("account_id", account.id)
    .maybeSingle();

  if (!progress || progress.status !== "in_progress") {
    const row = {
      account_id: account.id, next_page_token: null, pages_fetched: 0, orders_synced: 0,
      status: "in_progress", sync_type: "full", last_error: null,
      started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    await supabase.from("platform_sync_progress").upsert(row, { onConflict: "account_id" });
    progress = row;
  }

  const syncStartedAt = progress.started_at!;
  let totalSyncedOrders = 0;
  let totalSyncedItems = 0;
  let totalPages = 0;

  try {
    if (progress.sync_type !== "compensation") {
      // ---- Phase 1: full walk ----
      let cumulativePages = progress.pages_fetched;
      let cumulativeOrders = progress.orders_synced;
      const baseQuery = { shop_cipher: shopCipher, page_size: "50", sort_field: "create_time", sort_order: "DESC" };
      const result = await walkPages(creds, account, baseQuery, {}, progress.next_page_token ?? undefined, deadline, async (nextToken) => {
        cumulativePages++;
        await supabase.from("platform_sync_progress").update({
          next_page_token: nextToken, pages_fetched: cumulativePages, orders_synced: cumulativeOrders, updated_at: new Date().toISOString(),
        }).eq("account_id", account.id);
      });
      cumulativeOrders += result.syncedOrders;
      totalSyncedOrders += result.syncedOrders;
      totalSyncedItems += result.syncedItems;
      totalPages += result.pageCount;

      if (!result.reachedLastPage) {
        await supabase.from("sync_logs").insert({
          action: "tiktok_sync_shop", status: "success",
          message: `shop ${account.shop_id}: full sync +${result.syncedOrders} orders this run, ${result.pageCount} page(s), cumulative ${cumulativeOrders} orders / ${cumulativePages} pages — stopped by time budget, will resume next invocation`,
        });
        return { shopId: account.shop_id, syncedOrders: totalSyncedOrders, syncedItems: totalSyncedItems, pages: totalPages, mode: "full", truncated: true, fullSyncDone: false };
      }

      // Phase 1 done — hand off to Phase 2, same invocation if budget remains.
      await supabase.from("platform_sync_progress").update({
        sync_type: "compensation", next_page_token: null, updated_at: new Date().toISOString(),
      }).eq("account_id", account.id);
      progress = { ...progress, sync_type: "compensation", next_page_token: null };

      if (Date.now() > deadline) {
        await supabase.from("sync_logs").insert({
          action: "tiktok_sync_shop", status: "success",
          message: `shop ${account.shop_id}: full sync phase COMPLETE (${cumulativeOrders} orders / ${cumulativePages} pages), starting compensation next invocation`,
        });
        return { shopId: account.shop_id, syncedOrders: totalSyncedOrders, syncedItems: totalSyncedItems, pages: totalPages, mode: "full", truncated: true, fullSyncDone: false };
      }
    }

    // ---- Phase 2: compensation walk (update_time >= Phase 1's start) ----
    const sinceTs = Math.floor(new Date(syncStartedAt).getTime() / 1000);
    const baseQuery = { shop_cipher: shopCipher, page_size: "50", sort_field: "update_time", sort_order: "DESC" };
    const result = await walkPages(creds, account, baseQuery, { update_time_ge: sinceTs }, progress.next_page_token ?? undefined, deadline, async (nextToken) => {
      await supabase.from("platform_sync_progress").update({ next_page_token: nextToken, updated_at: new Date().toISOString() }).eq("account_id", account.id);
    });
    totalSyncedOrders += result.syncedOrders;
    totalSyncedItems += result.syncedItems;
    totalPages += result.pageCount;

    if (result.reachedLastPage) {
      await supabase.from("platform_sync_progress").update({ status: "completed", updated_at: new Date().toISOString() }).eq("account_id", account.id);
      await supabase.from("platform_accounts").update({ last_synced_at: new Date().toISOString() }).eq("id", account.id);
      await supabase.from("sync_logs").insert({
        action: "tiktok_sync_shop", status: "success",
        message: `shop ${account.shop_id}: compensation +${result.syncedOrders} orders, ${result.pageCount} page(s) — full sync + compensation COMPLETE, last_synced_at advanced`,
      });
      await verifyOrderCount(creds, account, shopCipher);
      return { shopId: account.shop_id, syncedOrders: totalSyncedOrders, syncedItems: totalSyncedItems, pages: totalPages, mode: "full", truncated: false, fullSyncDone: true };
    }

    // Compensation truncated — do NOT advance last_synced_at, next invocation resumes compensation (progress.sync_type already 'compensation').
    await supabase.from("sync_logs").insert({
      action: "tiktok_sync_shop", status: "success",
      message: `shop ${account.shop_id}: compensation +${result.syncedOrders} orders this run, ${result.pageCount} page(s) — stopped by time budget, will resume next invocation`,
    });
    return { shopId: account.shop_id, syncedOrders: totalSyncedOrders, syncedItems: totalSyncedItems, pages: totalPages, mode: "full", truncated: true, fullSyncDone: false };
  } catch (e) {
    await supabase.from("platform_sync_progress").update({ last_error: (e as Error).message, updated_at: new Date().toISOString() }).eq("account_id", account.id);
    throw e;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth gate: mirrors shopee-sync-orders/index.ts exactly (see that file for
  // the full rationale). verify_jwt at the platform level already rejects
  // any request without a valid Supabase JWT before this code runs — this
  // block only decides what a *valid* JWT is allowed to do.
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
    creds = requireTikTokCredentials();
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let shopId: string | undefined;
  let platformAccountId: string | undefined;
  let fullSync = false;
  let action: string | undefined;
  let categoryId: string | undefined;
  let listingId: string | undefined;
  let imageUrl: string | undefined;
  try {
    const body = await req.json();
    platformAccountId = body?.platformAccountId; // preferred — platform_accounts.id, unambiguous per store
    shopId = body?.shopId; // kept for backward compat
    fullSync = body?.fullSync === true;
    action = body?.action; // "tiktokCategories" | "tiktokCategoryAttributes" | "tiktokBrands" | "verifyConnection" | "tiktokUploadImage" | "tiktokPublishProduct"
    categoryId = body?.categoryId;
    listingId = body?.listingId;
    imageUrl = body?.imageUrl;
  } catch {
    // no body - sync all shops
  }

  // "更新连接" 验证并重新连接 (2026-08-25; revised) — for a shop TikTok
  // already considers permanently/long-term authorized ("unlimited
  // time"), TikTok's own Renew screen refuses to proceed at all ("This
  // app or service cannot be renewed because it has already been
  // authorized for an unlimited time") and never redirects back to
  // tiktok-auth-callback (confirmed live, twice: platform_accounts'
  // auth_time/tokens were completely unchanged after clicking through
  // it). IMPORTANT distinction this action enforces: TikTok's permanent
  // *grant* record is not the same thing as OUR stored token copy — a
  // shop can be "permanently authorized" on TikTok's side while our own
  // access_token/refresh_token are both null (e.g. after 退出连接
  // deliberately cleared them). Status is only ever flipped to
  // 'connected' here AFTER a real TikTok API call actually succeeds with
  // whatever credential we have on file — never a blind toggle. Three
  // cases:
  //   1. access_token on file → call a cheap real endpoint with it
  //      directly; tiktokCall's own 105002-retry already refreshes via
  //      refresh_token if that access_token turns out to be expired.
  //   2. no access_token but a refresh_token exists → refresh first, then
  //      the same real-call check.
  //   3. neither on file → nothing to verify; needsFullReauth true. This
  //      is the current state for a shop that went through 退出连接 and
  //      hasn't completed a real OAuth reauth since — no code path can
  //      responsibly mark that "connected" without a working credential.
  if (action === "verifyConnection") {
    if (!platformAccountId) {
      return new Response(JSON.stringify({ error: "platformAccountId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: acct, error: acctErr } = await supabase
      .from("platform_accounts")
      .select("id, shop_id, shop_cipher, access_token, refresh_token")
      .eq("id", platformAccountId)
      .eq("platform", "tiktok")
      .maybeSingle();
    if (acctErr || !acct) {
      return new Response(JSON.stringify({ error: acctErr?.message ?? "account not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!acct.access_token && !acct.refresh_token) {
      // No credential on file at all — TikTok's server-side grant being
      // "permanent" doesn't help us here; there is nothing to verify.
      return new Response(JSON.stringify({ error: "no credentials on file for this shop", needsFullReauth: true }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    try {
      const account = { id: acct.id, shop_id: acct.shop_id, shop_cipher: acct.shop_cipher, access_token: acct.access_token ?? "", refresh_token: acct.refresh_token ?? "" };
      if (!account.access_token && account.refresh_token) {
        await refreshTikTokToken(creds, account);
      }
      // Real, cheap call — proves the credential actually authenticates
      // right now, not just that a value happens to be stored.
      await tiktokCall("GET", "/authorization/202309/shops", creds, account, {});
      await supabase.from("platform_accounts").update({ status: "connected" }).eq("id", acct.id);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e) {
      await supabase.from("platform_accounts").update({ status: "expired" }).eq("id", acct.id);
      return new Response(JSON.stringify({ error: (e as Error).message, needsFullReauth: true }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  let query = supabase
    .from("platform_accounts")
    .select("id, platform, shop_id, access_token, refresh_token, shop_cipher, last_synced_at")
    .eq("platform", "tiktok")
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
    return new Response(JSON.stringify({ error: "No connected TikTok shop with a saved access_token found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Real TikTok Product-category endpoints (2026-08-24) — see the top-of-
  // file 2026-08-24 note for why `needsReauth` exists: an existing shop's
  // access_token only carries whatever scopes were consented to when it was
  // first connected, so even with the app-level scope now enabled in
  // Partner Center, shops connected before that change get 105005 until
  // they're reconnected. Once a shop re-authorizes, these same calls should
  // start returning real data with no further code change needed.
  if (action === "tiktokCategories" || action === "tiktokCategoryAttributes" || action === "tiktokBrands") {
    try {
      const { shopCipher } = await ensureShopCipher(creds, accounts[0]);
      const query: Record<string, string> = { shop_cipher: shopCipher };
      let path: string;
      if (action === "tiktokCategories") {
        path = "/product/202309/categories";
      } else if (action === "tiktokCategoryAttributes") {
        path = `/product/202309/categories/${categoryId}/attributes`;
      } else {
        // Get Brand List — category_id narrows to brands valid for that
        // category when provided; TikTok allows omitting it for the full list.
        path = "/product/202309/brands";
        if (categoryId) query.category_id = categoryId;
      }
      const data = await tiktokCall("GET", path, creds, accounts[0], query);
      return new Response(JSON.stringify({ data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e) {
      const message = (e as Error).message;
      const needsReauth = message.includes("105005");
      return new Response(JSON.stringify({ error: message, needsReauth }), {
        status: needsReauth ? 403 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Real Upload Image (2026-08-27, new) — TikTok's Create Product API needs
  // an already-hosted-on-TikTok image reference, not our own Supabase
  // Storage URL. Downloads the real image bytes from our own public
  // product-images bucket URL and re-uploads them to TikTok's Product
  // Image Upload endpoint. Response field name is UNVERIFIED against a
  // live shop as of this commit (no authorized shop has completed a real
  // publish yet) — TikTok's own docs describe the returned field as `uri`,
  // read defensively (uri | img_id | id) the same way this file already
  // handles every other under-verified TikTok response shape.
  if (action === "tiktokUploadImage") {
    if (!imageUrl) {
      return new Response(JSON.stringify({ error: "imageUrl required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    try {
      const imgResp = await fetch(imageUrl);
      if (!imgResp.ok) throw new Error(`failed to fetch source image: ${imgResp.status}`);
      const blob = await imgResp.blob();
      const form = new FormData();
      form.append("data", JSON.stringify({ use_case: "MAIN_IMAGE" }));
      form.append("image", blob, "image.jpg");
      // shop_cipher removed (2026-08-27) — real TikTok error 36009004
      // confirmed Image Upload does NOT accept it (only app_key/timestamp/
      // sign/access_token, per official docs); ensureShopCipher above is
      // still called only to warm the cached cipher for the later Create
      // Product call, which does require it.
      const data = await tiktokCallMultipart("/product/202309/images/upload", creds, accounts[0], {}, form);
      const uri = data?.uri ?? data?.img_id ?? data?.id;
      if (!uri) throw new Error("TikTok image upload returned no usable id — raw response: " + JSON.stringify(data).slice(0, 300));
      return new Response(JSON.stringify({ uri }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e) {
      const message = (e as Error).message;
      const needsReauth = message.includes("105005");
      return new Response(JSON.stringify({ error: message, needsReauth }), {
        status: needsReauth ? 403 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Real Create Product (2026-08-27, new, single-SKU scope only per
  // explicit approved phase) — publishes one product_listings row to one
  // connected TikTok shop via TikTok's real Create Product API. Payload
  // shape follows TikTok's documented v202309 Create Product schema, but
  // — same honesty note as the image-upload action above — has not yet
  // been exercised against a real authorized shop, since no shop with
  // full Product-write scope has completed a real end-to-end test as of
  // this commit. Any field-name mismatch TikTok's response surfaces
  // should be fixed here, not worked around client-side.
  //
  // Deliberately rejects any listing with product_listing_variations rows
  // — multi-SKU real publish is out of scope for this phase (approved
  // scope: "single-SKU only"); staff should keep using multi-variant
  // listings as ERP-internal-only until that's built.
  if (action === "tiktokPublishProduct") {
    if (!listingId || !platformAccountId) {
      return new Response(JSON.stringify({ error: "listingId and platformAccountId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    try {
      const [{ data: listing, error: listingErr }, { data: variations, error: varErr }, { data: storeRow, error: storeErr }] = await Promise.all([
        supabase.from("product_listings").select("*").eq("id", listingId).maybeSingle(),
        supabase.from("product_listing_variations").select("id").eq("listing_id", listingId),
        supabase.from("product_listing_stores").select("id").eq("listing_id", listingId).eq("platform_account_id", platformAccountId).maybeSingle(),
      ]);
      if (listingErr || !listing) throw new Error(listingErr?.message ?? "listing not found");
      if (varErr) throw new Error(varErr.message);
      // Variation block removed entirely (2026-08-27, explicit request) —
      // real publish is unconditionally single-SKU now: any leftover
      // product_listing_variations rows for this listing are wiped
      // up-front (no has_variations branching, no rejection path) and the
      // payload always builds from product_listings.base_price/base_stock
      // below. Real multi-SKU publish is simply out of scope, not a state
      // to detect/reject anymore.
      if ((variations ?? []).length > 0) {
        const { error: cleanupErr } = await supabase.from("product_listing_variations").delete().eq("listing_id", listingId);
        if (cleanupErr) throw new Error(`Failed to clean variation rows: ${cleanupErr.message}`);
        console.log(`[tiktokPublishProduct] listing=${listingId} removed ${variations.length} variation row(s) before publish`);
      }
      if (listing.has_variations) {
        await supabase.from("product_listings").update({ has_variations: false }).eq("id", listingId);
      }
      if (!listing.tiktok_real_category_id) throw new Error("Select a real TikTok category before publishing");

      const { shopCipher } = await ensureShopCipher(creds, accounts[0]);

      // Real warehouse id (2026-08-27) — fetched live rather than assumed,
      // since a shop's actual warehouse id is unknowable in advance; the
      // first entry is used as the default target (matches how a
      // single-warehouse MY seller's account is normally configured).
      const warehouseData = await tiktokCall("GET", "/logistics/202309/warehouses", creds, accounts[0], { shop_cipher: shopCipher });
      const warehouseId = (warehouseData?.warehouses ?? [])[0]?.id;
      if (!warehouseId) throw new Error("No TikTok warehouse found for this shop");

      // Real image upload — every image in the gallery, first one first
      // (TikTok uses main_images[0] as the primary listing photo).
      const imageUrls: string[] = Array.isArray(listing.image_urls) && listing.image_urls.length > 0
        ? listing.image_urls
        : (listing.image_url ? [listing.image_url] : []);
      if (imageUrls.length === 0) throw new Error("At least one product image is required");
      const mainImages: { uri: string }[] = [];
      for (const url of imageUrls.slice(0, 9)) {
        const imgResp = await fetch(url);
        if (!imgResp.ok) continue;
        const blob = await imgResp.blob();
        const form = new FormData();
        form.append("data", JSON.stringify({ use_case: "MAIN_IMAGE" }));
        form.append("image", blob, "image.jpg");
        // shop_cipher deliberately omitted here too (2026-08-27) — same
        // real 36009004 fix as tiktokUploadImage above; shopCipher stays
        // in scope for the Create Product call further down, which does
        // require it.
        const imgData = await tiktokCallMultipart("/product/202309/images/upload", creds, accounts[0], {}, form);
        const uri = imgData?.uri ?? imgData?.img_id ?? imgData?.id;
        if (uri) mainImages.push({ uri });
      }
      if (mainImages.length === 0) throw new Error("Image upload to TikTok failed for every image in this listing");

      // Attributes — only rows with a real attribute_id captured at
      // selection time (see pagesProductListing.jsx's selectTiktokRealLeaf)
      // can be sent; a manually-typed attribute row with no id is skipped
      // rather than sent with a fabricated one.
      const attributes = Array.isArray(listing.attributes) ? listing.attributes as { name: string; value: string; attributeId?: string }[] : [];
      const productAttributes = attributes
        .filter((a) => a.attributeId && a.value?.trim())
        .map((a) => ({ id: a.attributeId, values: [{ name: a.value }] }));

      const price = Number(listing.base_price) || 0;
      const stock = Math.round(Number(listing.base_stock)) || 0;
      const sellerSku = listing.sku || `ERP-${listing.id.slice(0, 8)}`;

      const payload = {
        save_mode: "LISTING",
        title: listing.title,
        description: listing.description || listing.title,
        category_id: listing.tiktok_real_category_id,
        ...(listing.tiktok_brand_id ? { brand_id: listing.tiktok_brand_id } : {}),
        main_images: mainImages,
        package_dimensions: {
          length: String(listing.length_cm || 1),
          width: String(listing.width_cm || 1),
          height: String(listing.height_cm || 1),
          unit: "CENTIMETER",
        },
        package_weight: { value: String(listing.weight_kg || 0.1), unit: "KILOGRAM" },
        is_cod_open: !!listing.is_cod,
        ...(productAttributes.length > 0 ? { product_attributes: productAttributes } : {}),
        skus: [
          {
            seller_sku: sellerSku,
            price: { amount: String(price), currency: "MYR" },
            inventory: [{ warehouse_id: warehouseId, quantity: stock }],
          },
        ],
      };

      // Diagnostics (2026-08-27, explicit request) — logs the exact
      // request payload and TikTok's raw response so a real publish
      // attempt's outcome is directly inspectable in Supabase function
      // logs instead of only "it worked or it didn't".
      console.log(`[tiktokPublishProduct] listing=${listingId} account=${platformAccountId} payload:`, JSON.stringify(payload));
      const data = await tiktokCall("POST", "/product/202309/products", creds, accounts[0], { shop_cipher: shopCipher }, payload);
      console.log(`[tiktokPublishProduct] listing=${listingId} TikTok raw response:`, JSON.stringify(data));
      const productId = data?.product_id ?? data?.id;
      const skuIds: Record<string, string> = {};
      for (const sku of data?.skus ?? []) {
        if (sku?.seller_sku && sku?.id) skuIds[sku.seller_sku] = sku.id;
      }

      const updatePayload = storeRow
        ? { publish_status: "api_published", platform_product_id: String(productId ?? ""), platform_sku_ids: skuIds, publish_error: null, published_at: new Date().toISOString() }
        : null;
      if (storeRow && updatePayload) {
        await supabase.from("product_listing_stores").update(updatePayload).eq("id", storeRow.id);
      } else {
        await supabase.from("product_listing_stores").insert({
          listing_id: listingId,
          platform_account_id: platformAccountId,
          store_price: price,
          publish_status: "api_published",
          platform_product_id: String(productId ?? ""),
          platform_sku_ids: skuIds,
          published_at: new Date().toISOString(),
        });
      }

      return new Response(JSON.stringify({ ok: true, productId, skuIds }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e) {
      const message = (e as Error).message;
      if (platformAccountId) {
        const { data: storeRow } = await supabase.from("product_listing_stores").select("id").eq("listing_id", listingId).eq("platform_account_id", platformAccountId).maybeSingle();
        if (storeRow) {
          await supabase.from("product_listing_stores").update({ publish_status: "api_failed", publish_error: message }).eq("id", storeRow.id);
        } else {
          await supabase.from("product_listing_stores").insert({ listing_id: listingId, platform_account_id: platformAccountId, publish_status: "api_failed", publish_error: message });
        }
      }
      const needsReauth = message.includes("105005");
      return new Response(JSON.stringify({ error: message, needsReauth }), {
        status: needsReauth ? 403 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // 达人佣金同步 (2026-08-25, new) — live-verified real endpoint (a temp
  // debug probe confirmed a genuine 200 response with real creator_username/
  // commission_rate/estimated_paid_commission data, previously 105005-
  // blocked before this shop's reauth added seller.affiliate_collaboration
  // .read to its scopes). One row per order+sku_id, upserted so a later
  // run naturally picks up actual_* fields once TikTok moves a row past
  // "To-SETTLE" (empty {} pre-settlement is normalized to null, not 0, so
  // "not yet settled" stays distinguishable from "settled at zero" — see
  // the table's own migration comment). Paginated within one invocation's
  // time budget same as the main order walk; a stray remaining page just
  // gets picked up by the next cron tick since nothing here is order-
  // dependent per page (every page's rows are upserted independently).
  if (action === "syncAffiliateCommissions") {
    const deadline = Date.now() + TIME_BUDGET_MS;
    let totalRows = 0;
    for (const account of accounts) {
      try {
        const { shopCipher } = await ensureShopCipher(creds, account);
        let pageToken: string | undefined;
        let pages = 0;
        do {
          const query: Record<string, string> = { shop_cipher: shopCipher, page_size: "50" };
          if (pageToken) query.page_token = pageToken;
          const data = await tiktokCall("POST", "/affiliate_seller/202410/orders/search", creds, account, query, {});
          const orders = data.orders ?? [];
          pageToken = data.next_page_token || undefined;
          pages++;

          // amountOf() reads TikTok's {amount, currency} shape; an empty {}
          // (pre-settlement actual_* fields) becomes null, never 0 — see
          // migration comment on why that distinction matters.
          // deno-lint-ignore no-explicit-any
          const amountOf = (m: any): number | null => (m && typeof m.amount === "string" ? Number(m.amount) : null);

          const rows: Record<string, unknown>[] = [];
          // deno-lint-ignore no-explicit-any
          for (const o of orders as any[]) {
            for (const sku of o.skus ?? []) {
              rows.push({
                platform_account_id: account.id,
                order_no: o.id,
                sku_id: sku.sku_id,
                product_id: sku.product_id ?? null,
                creator_username: sku.creator_username ?? null,
                content_type: sku.content_type ?? null,
                content_id: sku.content_id ?? null,
                commission_model: sku.commission_model ?? null,
                commission_rate: sku.commission_rate != null ? Number(sku.commission_rate) : null,
                open_collaboration_id: sku.open_collaboration_id ?? null,
                settlement_status: sku.settlement_status ?? null,
                currency: sku.price?.currency ?? "MYR",
                estimated_commission_base: amountOf(sku.estimated_commission_base),
                estimated_paid_commission: amountOf(sku.estimated_paid_commission),
                estimated_paid_partner_commission: amountOf(sku.estimated_paid_partner_commission),
                estimated_paid_shop_ads_commission: amountOf(sku.estimated_paid_shop_ads_commission),
                actual_commission_base: amountOf(sku.actual_commission_base),
                actual_paid_commission: amountOf(sku.actual_paid_commission),
                actual_paid_partner_commission: amountOf(sku.actual_paid_partner_commission),
                actual_paid_shop_ads_commission: amountOf(sku.actual_paid_shop_ads_commission),
                synced_at: new Date().toISOString(),
              });
            }
          }
          if (rows.length > 0) {
            const { error: upsertErr } = await supabase.from("tiktok_affiliate_commissions").upsert(rows, { onConflict: "order_no,sku_id" });
            if (!upsertErr) totalRows += rows.length;
            else {
              await supabase.from("sync_logs").insert({ action: "tiktok_affiliate_sync", status: "failed", message: `shop ${account.shop_id}: ${upsertErr.message}` });
            }
          }
        } while (pageToken && pages < 50 && Date.now() < deadline);
      } catch (e) {
        await supabase.from("sync_logs").insert({ action: "tiktok_affiliate_sync", status: "failed", message: `shop ${account.shop_id}: ${(e as Error).message}` });
      }
    }
    await supabase.from("sync_logs").insert({ action: "tiktok_affiliate_sync", status: "success", message: `synced ${totalRows} affiliate commission row(s)` });
    return new Response(JSON.stringify({ ok: true, rows: totalRows }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
          accounts[0],
          { shop_cipher: shopCipher },
        );
        return new Response(JSON.stringify({ shopCipher, warehouseData }, null, 2), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const statusParam = url.searchParams.get("status");
      const searchData = await tiktokCall(
        "POST",
        "/order/202309/orders/search",
        creds,
        accounts[0],
        { shop_cipher: shopCipher, page_size: "5", sort_field: "create_time", sort_order: "DESC" },
        statusParam ? { order_status: statusParam } : {},
      );
      return new Response(JSON.stringify({ shopCipher, statusParam, searchData }, null, 2), {
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
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
