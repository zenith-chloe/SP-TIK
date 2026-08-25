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
    // sale_price already nets out platform_discount (TikTok-funded, not a
    // real cost to the seller), so pre-settlement Est. Revenue built from
    // sale_price undercounts vs TikTok's own real estimate, which is based
    // on original_price ("subtotal before/after seller discounts" in
    // TikTok's Settlement Breakdown UI — live-verified against real order
    // 585688274303748056: TikTok showed RM138 revenue, we showed RM124.20,
    // gap of RM13.80 exactly explained by this order's real platform_discount).
    // Summed the same way sale_price already is, for the same reason
    // (multiple line_items per SKU).
    const itemsBySku = new Map<string, { productName: string; variation: string | null; qty: number; subtotal: number; originalPrice: number; imageUrl: string | null }>();
    for (const item of o.line_items ?? []) {
      const sku = item.seller_sku || item.sku_id || String(item.id);
      const salePrice = Number(item.sale_price ?? 0);
      const originalPrice = Number(item.original_price ?? item.sale_price ?? 0);
      const existing = itemsBySku.get(sku);
      if (existing) {
        existing.qty += 1;
        existing.subtotal += salePrice;
        existing.originalPrice += originalPrice;
      } else {
        itemsBySku.set(sku, {
          productName: item.product_name,
          variation: item.sku_name ?? null,
          qty: 1,
          subtotal: salePrice,
          originalPrice,
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
  try {
    const body = await req.json();
    platformAccountId = body?.platformAccountId; // preferred — platform_accounts.id, unambiguous per store
    shopId = body?.shopId; // kept for backward compat
    fullSync = body?.fullSync === true;
    action = body?.action; // "tiktokCategories" | "tiktokCategoryAttributes" | "tiktokBrands"
    categoryId = body?.categoryId;
  } catch {
    // no body - sync all shops
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
