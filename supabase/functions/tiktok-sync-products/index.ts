import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// TikTok Shop -> ERP 商品管理 sync (2026-09-27 rewrite of the deployed v25).
// Pages through POST /product/202309/products/search via next_page_token,
// splits every product into one row per real TikTok SKU (seller_sku — never
// the product_id), and inserts into the existing `products` table.
//
// Only ACTIVATE products with a real seller_sku are imported. Seller SKUs
// shared by several TikTok SKUs, and rows whose sku / platform_sync_id
// already exist in products, are skipped and reported — never overwritten,
// never blocking the rest. Inserts are row-by-row with every error checked.
//
// Body: { platformAccountId, limit?, dryRun?, inspect?, action?, productId? }
//   action: "variantDetail" + productId -> logged-in, read-only live
//                     Get Product Detail (variants/attributes/stock), no write
//   inspect: true  -> read-only, returns the raw first page's first product
//   dryRun:  true  -> read-only, full parse + skip/conflict counts, no write
//   (default)      -> owner-only: parse, skip conflicts, insert row by row

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const API_HOST = "https://open-api.tiktokglobalshop.com";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };

function nowTs(): number { return Math.floor(Date.now() / 1000); }

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: corsHeaders });
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signApiRequest(path: string, appSecret: string, queryParams: Record<string, string>, rawBody = ""): Promise<string> {
  const sortedKeys = Object.keys(queryParams).filter(k => k !== "sign" && k !== "access_token").sort();
  let base = path;
  for (const k of sortedKeys) base += k + queryParams[k];
  base += rawBody;
  const wrapped = `${appSecret}${base}${appSecret}`;
  return hmacSha256Hex(appSecret, wrapped);
}

async function autoRecoverShopCipher(appKey: string, appSecret: string, accessToken: string, accountId: string): Promise<string> {
  const timestamp = String(nowTs());
  const queryParams: Record<string, string> = { app_key: appKey, timestamp };
  const path = "/authorization/202309/shops";
  queryParams.sign = await signApiRequest(path, appSecret, queryParams);
  const url = new URL(`${API_HOST}${path}`);
  Object.entries(queryParams).forEach(([k, v]) => { url.searchParams.set(k, v); });
  const resp = await fetch(url.toString(), { method: "GET", headers: { "Content-Type": "application/json", "x-tts-access-token": accessToken } });
  const data = await resp.json();
  if (!resp.ok || data.code !== 0) throw new Error(`TikTok ${path} HTTP ${resp.status} code ${data.code}: ${data.message ?? ""}`);
  const cipher = data.data?.shops?.[0]?.cipher;
  if (!cipher || typeof cipher !== "string") throw new Error("No shop cipher in TikTok response");
  await supabase.from("platform_accounts").update({ shop_cipher: cipher }).eq("id", accountId);
  return cipher;
}

// One page of Search Products. Throws with TikTok's real HTTP status + code +
// message whenever the call isn't a genuine success (code !== 0).
async function searchProductsPage(appKey: string, appSecret: string, accessToken: string, shopCipher: string, pageSize: number, pageToken?: string) {
  const path = "/product/202309/products/search";
  const queryParams: Record<string, string> = { app_key: appKey, timestamp: String(nowTs()), shop_cipher: shopCipher, page_size: String(pageSize) };
  if (pageToken) queryParams.page_token = pageToken;
  const rawBody = JSON.stringify({});
  queryParams.sign = await signApiRequest(path, appSecret, queryParams, rawBody);
  const url = new URL(`${API_HOST}${path}`);
  Object.entries(queryParams).forEach(([k, v]) => { url.searchParams.set(k, v); });
  const resp = await fetch(url.toString(), { method: "POST", headers: { "Content-Type": "application/json", "x-tts-access-token": accessToken }, body: rawBody });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`TikTok ${path} HTTP ${resp.status}: non-JSON response ${text.slice(0, 200)}`); }
  if (!resp.ok || data.code !== 0) throw new Error(`TikTok ${path} HTTP ${resp.status} code ${data.code}: ${data.message ?? ""} (request_id ${data.request_id ?? "-"})`);
  return data.data ?? {};
}

// Get Product Detail — Search Products (verified live 2026-09-27) returns
// no image field at all, so main_images only comes from here.
async function getProductDetail(appKey: string, appSecret: string, accessToken: string, shopCipher: string, productId: string) {
  const path = `/product/202309/products/${productId}`;
  const queryParams: Record<string, string> = { app_key: appKey, timestamp: String(nowTs()), shop_cipher: shopCipher };
  queryParams.sign = await signApiRequest(path, appSecret, queryParams);
  const url = new URL(`${API_HOST}${path}`);
  Object.entries(queryParams).forEach(([k, v]) => { url.searchParams.set(k, v); });
  console.log("[getProductDetail] Calling TikTok API:", { path, productId, url: url.toString() });
  const resp = await fetch(url.toString(), { method: "GET", headers: { "Content-Type": "application/json", "x-tts-access-token": accessToken } });
  const data = await resp.json();
  console.log("[getProductDetail] TikTok API response:", { code: data.code, message: data.message, data_keys: Object.keys(data.data || {}), sku_count: (data.data?.skus || []).length });
  if (!resp.ok || data.code !== 0) throw new Error(`TikTok ${path} HTTP ${resp.status} code ${data.code}: ${data.message ?? ""}`);
  return data.data ?? {};
}

// deno-lint-ignore no-explicit-any
function productImage(p: any): string | null {
  return p.main_images?.[0]?.urls?.[0] ?? p.main_images?.[0]?.thumb_urls?.[0] ?? null;
}

// deno-lint-ignore no-explicit-any
function skuPrice(s: any): number {
  const v = s.price?.sale_price ?? s.price?.tax_exclusive_price;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function isLoggedIn(req: Request): Promise<boolean> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data: userData } = await supabase.auth.getUser(token);
  return !!userData?.user?.id;
}

async function isOwner(req: Request): Promise<boolean> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data: userData } = await supabase.auth.getUser(token);
  const uid = userData?.user?.id;
  if (!uid) return false;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
  return profile?.role === "owner";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) || {};
    const { platformAccountId, limit = 100, dryRun = false, inspect = false, action, productId } = body;
    if (!platformAccountId) return json({ success: false, message: "platformAccountId required" });

    const variantMode = action === "variantDetail";
    if (variantMode) {
      if (!productId || !/^\d+$/.test(String(productId))) return json({ success: false, message: "productId required" });
      if (!(await isLoggedIn(req))) return json({ success: false, message: "请先登录 / Login required" });
    }

    const writeMode = !dryRun && !inspect && !variantMode;
    if (writeMode && !(await isOwner(req))) {
      return json({ success: false, message: "仅限 owner 同步写入商品 / Owner only" });
    }

    const appKey = Deno.env.get("TIKTOK_APP_KEY")?.trim();
    const appSecret = Deno.env.get("TIKTOK_APP_SECRET")?.trim();
    if (!appKey || !appSecret) return json({ success: false, message: "Missing TIKTOK_APP_KEY or TIKTOK_APP_SECRET" });

    const { data: account, error: acctErr } = await supabase.from("platform_accounts").select("id, platform, shop_id, access_token, shop_cipher").eq("id", platformAccountId).maybeSingle();
    if (acctErr || !account) return json({ success: false, message: `DB error: ${acctErr?.message || "not found"}` });
    if (account.platform !== "tiktok") return json({ success: false, message: "Not a TikTok account" });
    if (!account.access_token) return json({ success: false, message: "TikTok token missing — 请在店铺管理重新授权" });

    const shopCipher = account.shop_cipher || await autoRecoverShopCipher(appKey, appSecret, account.access_token, platformAccountId);
    const pageSize = Math.min(Math.max(Number(limit) || 100, 1), 100);

    // Read-only Variant Detail for 商品管理's expanded product row: one live
    // Get Product Detail call, nothing written anywhere.
    if (variantMode) {
      const detail = await getProductDetail(appKey, appSecret, account.access_token, shopCipher, String(productId));
      const mainImage = productImage(detail);
      console.log("[variantMode] Product Detail received:", { id: detail.id, skus_count: (detail.skus || []).length, skus_keys: detail.skus ? Object.keys(detail.skus[0] || {}) : "N/A", title: detail.title });
      // deno-lint-ignore no-explicit-any
      const skus = (Array.isArray(detail.skus) ? detail.skus : []).map((s: any) => ({
        sku_id: String(s.id),
        seller_sku: typeof s.seller_sku === "string" ? s.seller_sku.trim() : "",
        // deno-lint-ignore no-explicit-any
        attributes: (Array.isArray(s.sales_attributes) ? s.sales_attributes : []).map((a: any) => ({ name: a.name ?? "", value: a.value_name ?? "" })),
        // deno-lint-ignore no-explicit-any
        stock: (Array.isArray(s.inventory) ? s.inventory : []).reduce((sum: number, inv: any) => sum + (Number(inv.quantity) || 0), 0),
        price: skuPrice(s),
        // deno-lint-ignore no-explicit-any
        image: (Array.isArray(s.sales_attributes) ? s.sales_attributes : []).map((a: any) => a.sku_img?.urls?.[0]).find(Boolean) ?? mainImage,
      }));
      return json({ success: true, product_id: String(detail.id ?? productId), title: detail.title ?? null, status: detail.status ?? null, main_image: mainImage, sku_count: skus.length, skus, debug: { api_response_keys: Object.keys(detail) } });
    }

    if (inspect) {
      const page = await searchProductsPage(appKey, appSecret, account.access_token, shopCipher, 1);
      return json({ success: true, inspect: true, total_count: page.total_count ?? null, data_keys: Object.keys(page), first_product: page.products?.[0] ?? null });
    }

    // 1. Fetch every page.
    // deno-lint-ignore no-explicit-any
    const apiProducts: any[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    let totalCount: number | null = null;
    do {
      const page = await searchProductsPage(appKey, appSecret, account.access_token, shopCipher, pageSize, pageToken);
      pages++;
      totalCount = page.total_count ?? totalCount;
      apiProducts.push(...(page.products ?? []));
      pageToken = page.next_page_token || undefined;
    } while (pageToken && pages < 100);

    // 1a. Only ACTIVATE products are imported; DELETED/FREEZE/DRAFT etc. are
    // counted and skipped.
    const statusBreakdown: Record<string, number> = {};
    for (const p of apiProducts) { const k = String(p.status ?? "<none>"); statusBreakdown[k] = (statusBreakdown[k] ?? 0) + 1; }
    const activeProducts = apiProducts.filter(p => p.status === "ACTIVATE");

    // 1b. Images via Get Product Detail, 5 at a time (Search Products has no
    // image field). A failed detail call only leaves that image empty.
    const imageErrors: Array<{ product_id: string; error: string }> = [];
    for (let i = 0; i < activeProducts.length; i += 5) {
      await Promise.all(activeProducts.slice(i, i + 5).map(async (p) => {
        try {
          const detail = await getProductDetail(appKey, appSecret, account.access_token, shopCipher, String(p.id));
          p.main_images = detail.main_images ?? null;
        } catch (e) {
          imageErrors.push({ product_id: String(p.id), error: (e as Error).message });
        }
      }));
    }

    // 2. Parse: one row per TikTok SKU, keyed by seller_sku. platform_sync_id
    // = tiktok_<product_id>_<sku_id> — unique per variant (so several SKUs of
    // one product never collide) and traceable back to the exact TikTok
    // product + SKU without any schema change; sku column = seller_sku.
    type Row = { sku: string; name: string; price: number; image_url: string | null; platform: string; platform_sync_id: string; tiktok_product_id: string; tiktok_sku_id: string };
    const noSellerSku: Array<{ product_id: string; sku_id: string | null; title: string | null; reason: string }> = [];
    const parsed: Row[] = [];
    for (const p of activeProducts) {
      const title = typeof p.title === "string" ? p.title.trim() : "";
      const skus = Array.isArray(p.skus) ? p.skus : [];
      if (!title) { noSellerSku.push({ product_id: String(p.id), sku_id: null, title: null, reason: "missing title" }); continue; }
      for (const s of skus) {
        const sellerSku = typeof s.seller_sku === "string" ? s.seller_sku.trim() : "";
        if (!sellerSku) { noSellerSku.push({ product_id: String(p.id), sku_id: String(s.id), title, reason: "empty seller_sku" }); continue; }
        parsed.push({
          sku: sellerSku,
          name: title,
          price: skuPrice(s),
          image_url: productImage(p),
          platform: "tiktok",
          platform_sync_id: `tiktok_${p.id}_${s.id}`,
          tiktok_product_id: String(p.id),
          tiktok_sku_id: String(s.id),
        });
      }
    }

    // 3a. Seller SKUs used by more than one TikTok SKU: every row of that
    // seller_sku is skipped (can't pick one without guessing) — does not
    // block the rest.
    const bySku = new Map<string, Row[]>();
    for (const r of parsed) bySku.set(r.sku, [...(bySku.get(r.sku) ?? []), r]);
    const tiktokDuplicates = [...bySku.entries()].filter(([, g]) => g.length > 1).map(([sku, g]) => ({
      seller_sku: sku,
      tiktok: g.map(r => ({ product_id: r.tiktok_product_id, sku_id: r.tiktok_sku_id, title: r.name })),
    }));
    const dupSkus = new Set(tiktokDuplicates.map(d => d.seller_sku));
    const unique = parsed.filter(r => !dupSkus.has(r.sku));

    // 3b. Rows whose sku or platform_sync_id already exists in products are
    // skipped — existing ERP products are never overwritten.
    const existingSku = new Map<string, { sku: string; name: string; platform: string | null; platform_sync_id: string | null }>();
    const existingSync = new Set<string>();
    for (let i = 0; i < unique.length; i += 200) {
      const chunk = unique.slice(i, i + 200);
      const { data: a, error: ea } = await supabase.from("products").select("sku, name, platform, platform_sync_id").in("sku", chunk.map(r => r.sku));
      if (ea) throw new Error(`products sku lookup failed: ${ea.message}`);
      for (const e of a ?? []) existingSku.set(e.sku, e);
      const { data: b, error: eb } = await supabase.from("products").select("platform_sync_id").in("platform_sync_id", chunk.map(r => r.platform_sync_id));
      if (eb) throw new Error(`products platform_sync_id lookup failed: ${eb.message}`);
      for (const e of b ?? []) if (e.platform_sync_id) existingSync.add(e.platform_sync_id);
    }
    const erpConflicts: Array<Record<string, unknown>> = [];
    const toWrite: Row[] = [];
    for (const r of unique) {
      if (existingSync.has(r.platform_sync_id)) { erpConflicts.push({ type: "platform_sync_id already exists (already imported)", seller_sku: r.sku, platform_sync_id: r.platform_sync_id }); continue; }
      const hit = existingSku.get(r.sku);
      if (hit) { erpConflicts.push({ type: "products.sku already exists", seller_sku: r.sku, tiktok_product_id: r.tiktok_product_id, tiktok_sku_id: r.tiktok_sku_id, existing_erp: hit }); continue; }
      toWrite.push(r);
    }

    const summary = {
      api_total_count: totalCount,
      api_products_returned: apiProducts.length,
      pages,
      tiktok_status_breakdown: statusBreakdown,
      active_products: activeProducts.length,
      active_sku_total: parsed.length + noSellerSku.filter(s => s.reason === "empty seller_sku").length,
      valid_seller_sku_rows: parsed.length,
      no_seller_sku: noSellerSku.length,
      tiktok_duplicate_seller_skus: tiktokDuplicates.length,
      tiktok_duplicate_rows_skipped: parsed.length - unique.length,
      erp_conflicts: erpConflicts.length,
      expected_write: toWrite.length,
      with_image: toWrite.filter(r => r.image_url).length,
      image_errors: imageErrors,
    };

    if (dryRun) {
      return json({ success: true, dryRun: true, written: 0, ...summary, tiktok_duplicates: tiktokDuplicates, erp_conflict_list: erpConflicts, no_seller_sku_list: noSellerSku, sample: toWrite.slice(0, 5) });
    }

    // 4. Row-by-row insert (never upsert): one failure never blocks the
    // others, every error is checked and reported.
    const written: Row[] = [];
    const failed: Array<{ seller_sku: string; platform_sync_id: string; error: string }> = [];
    for (const r of toWrite) {
      const { error } = await supabase.from("products").insert({ sku: r.sku, name: r.name, price: r.price, image_url: r.image_url, platform: r.platform, platform_sync_id: r.platform_sync_id }).select("id").single();
      if (error) failed.push({ seller_sku: r.sku, platform_sync_id: r.platform_sync_id, error: error.message });
      else written.push(r);
    }

    // Frontend (pagesProducts.jsx) re-upserts the returned `products` on
    // platform_sync_id = `tiktok_${id}` — id = <product_id>_<sku_id> points
    // it at exactly the rows just inserted (same values, no-op) and its
    // "已导入 N" count equals the real written count. Failed/skipped rows
    // are never returned, so it can't write them either.
    const products = written.map(r => ({ id: `${r.tiktok_product_id}_${r.tiktok_sku_id}`, sku: r.sku, title: r.name, price: r.price, image: r.image_url }));
    return json({
      success: failed.length === 0,
      message: failed.length === 0 ? `已导入 ${written.length} 个 TikTok SKU` : `已导入 ${written.length} 个，${failed.length} 个写入失败`,
      written: written.length,
      failed_count: failed.length,
      failed,
      ...summary,
      tiktok_duplicates: tiktokDuplicates,
      erp_conflict_list: erpConflicts,
      products,
      count: written.length,
    });
  } catch (err) {
    console.error("[tiktok-sync-products]", (err as Error).message);
    return json({ success: false, message: (err as Error).message });
  }
});
