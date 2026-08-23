import React, { useState, useEffect, useRef } from "react";
import { Boxes, RefreshCw, LogIn, LogOut, AlertTriangle, Menu, X, Puzzle, Info } from "lucide-react";
import {
  supabaseClient, mapDbStore, mapDbProduct, mapDbSupplier, mapDbPurchaseOrder, mapDbOrder, mapDbTransferLog,
  mapDbAdjustmentRequest, mapDbCancellationRecord, DEMO_TO_DB_STATUS, DEMO_TO_DB_PLATFORM, NAV,
} from "./shared.jsx";
import { Overview, Orders, OrderDrawer, Inventory } from "./pagesOverviewOrders.jsx";
import { ProductMove } from "./pagesMove.jsx";
import { ManualImport, Finance, AIPanel, Roles, AdsSpend, PrintSlip, LabelPrinting } from "./pagesImportFinance.jsx";
import { Warehouse } from "./pagesWarehouse.jsx";
import { ProductMaster } from "./pagesProducts.jsx";
import { SupplierMaster } from "./pagesSuppliers.jsx";
import { PurchaseOrderList } from "./pagesPurchaseOrders.jsx";
import { InventoryAdjustment, AutoImportHub } from "./pagesInventoryAdjustment.jsx";
import { ShipPackageTest } from "./pagesShipTest.jsx";

// Supplier Management / Purchase Order (incl. Receiving) are not part of the
// current warehouse/staff workflow — owner-only until AutoCount purchasing
// sync is built. Code/schema stays intact, just hidden + access-gated.
const OWNER_ONLY_TAB_KEYS = ["suppliers", "purchaseorders", "shiptest", "roles"];

/* ============================== Login ============================== */

// 滑块拼图验证 (2026-08-20) — pure client-side gate in front of the same
// existing supabaseClient.auth.signInWithPassword call below; no backend,
// no new table, doesn't touch any frozen module. User drags the puzzle
// piece to align with the notch; on a correct release it immediately calls
// the real sign-in (no separate submit click needed) — a wrong release
// just resets the piece and lets them retry. This is a UX/basic-bot-
// friction gate, not a security boundary — real access control is still
// entirely Supabase Auth's password check underneath it.
// Shopee-style photo puzzle (2026-08-21 UI upgrade) — same "cookie-cutter"
// clip-path shape used for both the darkened hole and the floating piece, so
// the piece is a real crop of the photo (fixed background-position) that only
// visually lands in place once sliderX reaches targetX. Still a pure client-
// side UX/bot-friction gate, not a security boundary — see comment below.
const PUZZLE_PIECE_W = 56;
const PUZZLE_CARD_H = 160;
const PUZZLE_CLIP =
  "polygon(0% 0%, 0% 30%, 15% 38%, 15% 62%, 0% 70%, 0% 100%, 100% 100%, 100% 70%, 115% 62%, 115% 38%, 100% 30%, 100% 0%)";

function randomPuzzleImage() {
  const seed = Math.random().toString(36).slice(2, 10);
  return `https://picsum.photos/seed/${seed}/480/280`;
}

function SliderCaptcha({ t, onSolved }) {
  const trackRef = useRef(null);
  const cardRef = useRef(null);
  const [imgUrl, setImgUrl] = useState(randomPuzzleImage);
  const [cardW, setCardW] = useState(0);
  const [targetX, setTargetX] = useState(0); // px, within [0, cardW - PUZZLE_PIECE_W]
  const [sliderX, setSliderX] = useState(0); // px, same range
  const [dragging, setDragging] = useState(false);
  const [failed, setFailed] = useState(false);
  const TOLERANCE = 8; // px

  function rollTarget(w) {
    const maxX = Math.max(0, w - PUZZLE_PIECE_W);
    return Math.round(Math.min(maxX, PUZZLE_PIECE_W + 20 + Math.random() * Math.max(0, maxX - PUZZLE_PIECE_W - 20)));
  }

  useEffect(() => {
    function measure() {
      if (!cardRef.current) return;
      const w = cardRef.current.offsetWidth;
      setCardW(w);
      setTargetX((prev) => (prev > 0 ? prev : rollTarget(w)));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  function refresh() {
    setImgUrl(randomPuzzleImage());
    setSliderX(0);
    setFailed(false);
    if (cardW > 0) setTargetX(rollTarget(cardW));
  }

  function clampFromClientX(clientX) {
    const rect = trackRef.current.getBoundingClientRect();
    const maxX = Math.max(0, cardW - PUZZLE_PIECE_W);
    const px = ((clientX - rect.left) / rect.width) * maxX;
    return Math.max(0, Math.min(maxX, px));
  }

  function handlePointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    setFailed(false);
  }

  function handlePointerMove(e) {
    if (!dragging) return;
    setSliderX(clampFromClientX(e.clientX));
  }

  function handlePointerUp() {
    if (!dragging) return;
    setDragging(false);
    if (Math.abs(sliderX - targetX) <= TOLERANCE) {
      onSolved();
    } else {
      setFailed(true);
      setTimeout(() => { setSliderX(0); setFailed(false); }, 900);
    }
  }

  const maxSliderX = Math.max(0, cardW - PUZZLE_PIECE_W);
  const trackPct = maxSliderX > 0 ? (sliderX / maxSliderX) * 100 : 0;

  return (
    <div className="space-y-2">
      {/* photo card: real background image + puzzle-shaped hole + draggable piece */}
      <div
        ref={cardRef}
        className="relative w-full rounded-lg overflow-hidden bg-slate-100 border border-slate-200"
        style={{ height: PUZZLE_CARD_H }}
      >
        <img src={imgUrl} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" />
        {cardW > 0 && (
          <>
            {/* darkened cutout at the target location */}
            <div
              className="absolute top-0 pointer-events-none"
              style={{
                left: targetX,
                width: PUZZLE_PIECE_W,
                height: PUZZLE_CARD_H,
                clipPath: PUZZLE_CLIP,
                background: "rgba(10,15,30,0.55)",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.5)",
              }}
            />
            {/* draggable piece — a real crop of the same photo (fixed background-position) */}
            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="absolute top-0 cursor-grab active:cursor-grabbing touch-none"
              style={{
                left: sliderX,
                width: PUZZLE_PIECE_W,
                height: PUZZLE_CARD_H,
                clipPath: PUZZLE_CLIP,
                backgroundImage: `url(${imgUrl})`,
                backgroundSize: `${cardW}px ${PUZZLE_CARD_H}px`,
                backgroundPosition: `${-targetX}px 0`,
                boxShadow: failed
                  ? "inset 0 0 0 2px #f43f5e, 0 0 6px rgba(244,63,94,0.6)"
                  : "inset 0 0 0 2px #fff, 0 2px 6px rgba(0,0,0,0.35)",
              }}
            />
          </>
        )}
      </div>

      {/* refresh + info footer, Shopee-style */}
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-1 text-[11px] text-slate-400">
          <Info size={12} />
          {t("拖动下方滑块完成拼图验证", "Drag the slider below to complete the puzzle")}
        </div>
        <button
          type="button"
          onClick={refresh}
          title={t("换一张图片", "Refresh image")}
          className="text-slate-400 hover:text-teal-600"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* slider track */}
      <div
        ref={trackRef}
        className={`relative h-11 rounded-lg bg-slate-100 border overflow-hidden select-none ${failed ? "border-rose-300" : "border-slate-200"}`}
      >
        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400 pointer-events-none">
          {t("请向右拖动滑块完成拼图", "Please slide to complete the puzzle")}
        </div>
        <div className="absolute inset-y-0 left-0 bg-teal-100/70" style={{ width: `${trackPct}%` }} />
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className={`absolute top-1/2 -translate-y-1/2 h-9 w-9 rounded-md flex items-center justify-center text-white shadow cursor-grab active:cursor-grabbing touch-none ${failed ? "bg-rose-500" : "bg-teal-500"}`}
          style={{ left: `calc(${trackPct}% - 18px)` }}
        >
          <Puzzle size={16} />
        </div>
      </div>
      {failed && (
        <div className="text-[11px] text-rose-600">{t("对齐不正确，请重试", "Not aligned — please try again")}</div>
      )}
    </div>
  );
}

function LoginScreen({ t }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCaptcha, setShowCaptcha] = useState(false);

  async function doSignIn() {
    setError("");
    setBusy(true);
    // 手机号虚拟 Email (2026-08-20) — a staff account created from a bare
    // phone number is stored as phone@myerp.local (see admin-manage-staff's
    // toAuthEmail, same convention/domain); apply the identical conversion
    // here so typing just the phone number actually matches that account.
    // Real email logins are untouched (already contain "@").
    const authEmail = email.trim().includes("@") ? email.trim() : `${email.trim()}@myerp.local`;
    const { error: authError } = await supabaseClient.auth.signInWithPassword({ email: authEmail, password });
    setBusy(false);
    if (authError) { setError(authError.message); setShowCaptcha(false); }
  }

  function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setShowCaptcha(true); // reveals the puzzle; doSignIn only fires once it's solved
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="h-8 w-8 rounded-md bg-teal-500 flex items-center justify-center">
            <Boxes size={18} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">MY电商 ERP</div>
            <div className="text-[11px] text-slate-400 leading-tight">{t("AI 智能管理系统", "AI Management System")}</div>
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1 block">{t("手机号 / 邮箱", "Phone / Email")}</label>
          <input
            type="text"
            required
            disabled={showCaptcha}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-teal-400 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">{t("密码", "Password")}</label>
          <input
            type="password"
            required
            disabled={showCaptcha}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-teal-400 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>

        {showCaptcha && !busy && <SliderCaptcha t={t} onSolved={doSignIn} />}

        {error && (
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border bg-rose-50 text-rose-600 border-rose-200">
            <AlertTriangle size={13} /> {error}
          </div>
        )}

        {!showCaptcha && (
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-1.5 text-sm py-2 rounded-lg text-white bg-slate-900 hover:bg-slate-800"
          >
            <LogIn size={15} /> {t("登录", "Log in")}
          </button>
        )}
        {busy && (
          <div className="w-full flex items-center justify-center gap-1.5 text-sm py-2 rounded-lg text-white bg-slate-300 cursor-not-allowed">
            <LogIn size={15} /> {t("登录中…", "Signing in…")}
          </div>
        )}
      </form>
    </div>
  );
}

// Mirrors the idempotent insert-then-conditionally-update pattern the
// TikTok/Shopee sync edge functions use for stock_movements: the INSERT only
// succeeds the first time this (order, sku) pair is seen (UNIQUE(order_id,
// sku)), so re-printing the same order — or a later platform sync reaching
// the same order — never double-deducts, whichever trigger gets there first.
async function deductStockForPrintedItem(order, item) {
  if (order.platform_status === "UNPAID" || order.order_status === "cancelled") return;

  const { data: product } = await supabaseClient
    .from("products")
    .select("id, warehouse_a_qty")
    .eq("sku", item.sku)
    .maybeSingle();
  if (!product) return;

  const stockBefore = Math.max(product.warehouse_a_qty || 0, 0);
  // Never let warehouse_a_qty go negative: deduct at most what's actually there.
  const actualDeduction = Math.min(item.qty || 0, stockBefore);
  const stockAfter = stockBefore - actualDeduction;

  const { data: inserted, error: insertErr } = await supabaseClient
    .from("stock_movements")
    .insert({
      product_id: product.id,
      sku: item.sku,
      order_id: order.id,
      platform: order.platform,
      qty_deducted: actualDeduction,
      stock_before: stockBefore,
      stock_after: stockAfter,
    })
    .select("id")
    .maybeSingle();
  if (insertErr || !inserted) return; // 23505 = already deducted for this order+sku

  await supabaseClient
    .from("products")
    .update({ warehouse_a_qty: stockAfter })
    .eq("id", product.id)
    .then(({ error }) => error && console.error("print stock deduction: product update failed", error));
}

// Placeholder for TikTok's Fulfillment/Logistics API write-back (mark
// shipped + upload tracking number) once that OAuth scope is granted — the
// current token gets a 105005 access-denied on logistics endpoints, so
// there's nothing to call yet. Left as a no-op call site in the print flow
// so wiring the real API in later is additive, not a restructure.
async function syncFulfillmentToPlatform(_order) {
  // Intentionally empty until TikTok Fulfillment scope is approved.
}

/* ============================== App ============================== */

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = checking, null = logged out
  const [myRole, setMyRole] = useState(null);
  const [myStoreIds, setMyStoreIds] = useState([]);
  // 数据范围过滤 (2026-08-20) — loadRealData is called from a bunch of
  // places (the initial-load effect, the 20s silent-refresh setInterval,
  // and every mutation function's `loadRealData(true)` afterward), several
  // of which capture a loadRealData closure once and never refresh it (the
  // interval effect below only depends on [session], not myRole/
  // myStoreIds). Reading myRole/myStoreIds directly out of state inside
  // loadRealData would mean some of those captured closures see a stale
  // (possibly still-null) role forever. Refs sidestep that: the object
  // identity never changes, only .current, so every call site — no matter
  // which render's closure is invoked — always reads the latest resolved
  // value.
  const myRoleRef = useRef(null);
  const myStoreIdsRef = useRef([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [transferLogs, setTransferLogs] = useState([]);
  const [warehouseLocations, setWarehouseLocations] = useState([]);
  const [adjustmentRequests, setAdjustmentRequests] = useState([]);
  const [cancellationRecords, setCancellationRecords] = useState([]);
  const [stores, setStores] = useState([]);
  const [tab, setTab] = useState("overview");
  // One-shot navigation-intent state: set by the Dashboard's "待处理订单"
  // card popup so 订单管理中心 opens pre-selected to the chosen platform;
  // Orders consumes and clears it on mount. Pure UI nav state, not
  // persisted, not touching orders/DB.
  const [ordersEntryFilter, setOrdersEntryFilter] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [printOrders, setPrintOrders] = useState(null);
  // true when print was triggered from the Orders page (or its drawer) — no
  // design/edit access, always the plain locked platform order slip. false
  // when triggered from Label Printing (or Warehouse's picking list), which
  // keeps full template switching + the design overrides panel.
  const [printLocked, setPrintLocked] = useState(false);
  // Seeds PrintSlip's per-print overrides when reopened to reprint a
  // historical order from 打印记录 (PrintHistoryPanel) — { [order.id]: { sku, note } }.
  // Empty for every normal print path (Orders/Label Printing/Warehouse).
  const [printInitialOverrides, setPrintInitialOverrides] = useState({});
  function openLockedPrint(orders) { setPrintOrders(orders); setPrintLocked(true); setPrintInitialOverrides({}); }
  function openDesignPrint(orders) { setPrintOrders(orders); setPrintLocked(false); setPrintInitialOverrides({}); }
  // order/locked/overridesForOrder come from a print_history row — see
  // PrintHistoryPanel's fetchOrderForReprint, which resolves the historical
  // order_id back to a live, freshly-fetched order (never a stored PII
  // snapshot — print_history itself never stored recipient info).
  function reprintFromHistory(order, locked, overridesForOrder) {
    setPrintOrders([order]);
    setPrintLocked(locked);
    setPrintInitialOverrides({ [order.id]: overridesForOrder || {} });
  }
  const [lang, setLang] = useState("zh"); // "zh" | "en"
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const t = (zh, en) => (lang === "en" ? en : zh);
  const lastSyncAtRef = useRef(null);

  useEffect(() => {
    supabaseClient.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabaseClient.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Supplier Management / Purchase Order / Receiving are owner-only for now
  // (not part of the current warehouse/staff workflow) — this is the only
  // place the frontend needs to know its own role, purely for hiding nav
  // items and gating these two tabs. Actual write protection already lives
  // in RLS regardless of this. store_ids fetched alongside role (2026-08-20)
  // for the data-scope filtering below — same one query, same lifecycle,
  // so the two never resolve out of sync with each other.
  useEffect(() => {
    if (!session) { setMyRole(null); setMyStoreIds([]); return; }
    supabaseClient.from("profiles").select("role, store_ids").eq("id", session.user.id).maybeSingle()
      .then(({ data }) => { setMyRole(data?.role || "staff"); setMyStoreIds(data?.store_ids || []); });
  }, [session]);

  useEffect(() => { myRoleRef.current = myRole; }, [myRole]);
  useEffect(() => { myStoreIdsRef.current = myStoreIds; }, [myStoreIds]);

  const ORDER_COLUMNS = "id, order_no, platform, platform_account_id, buyer_name, buyer_phone, shipping_address, buyer_user_id, buyer_username, tracking_no, courier, order_status, platform_status, warehouse_stage, cancel_stage, is_cod, shipping_fee, order_date, ship_deadline, delivery_option, print_count, last_printed_at, last_printed_by, note_color, note_text, updated_at";

  // Supabase's REST API caps any single response at 1000 rows and a `.in()`
  // filter with thousands of ids blows past sane URL length limits, so once
  // order_items crossed that scale (after the TikTok full sync backfilled
  // thousands of historical orders) a single unbounded `.in(changedOrderIds)`
  // query silently came back truncated — orders past the cutoff got an empty
  // items array, which is why their SKU/photo/product name looked "missing"
  // even though order_items had the data all along. Two safeguards, not one:
  // chunking keeps each request's id list short enough to stay under URL
  // length limits, and `.range()` paging inside each chunk means even a
  // chunk whose orders happen to carry unusually many line items each still
  // gets read to completion instead of silently stopping at row 1000.
  async function fetchOrderItemsFor(orderIds) {
    const CHUNK_SIZE = 200;
    const PAGE_SIZE = 1000;
    const chunks = [];
    for (let i = 0; i < orderIds.length; i += CHUNK_SIZE) chunks.push(orderIds.slice(i, i + CHUNK_SIZE));

    async function fetchChunk(chunk) {
      const all = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabaseClient
          .from("order_items")
          .select("order_id, sku, product_name, variation, qty, unit_price, original_price, image_url")
          .in("order_id", chunk)
          .range(from, from + PAGE_SIZE - 1);
        if (error) {
          console.error("fetchOrderItemsFor chunk failed", error);
          break;
        }
        all.push(...(data || []));
        if (!data || data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      return all;
    }

    const results = await Promise.all(chunks.map(fetchChunk));
    return results.flat();
  }

  async function loadRealData(silent = false) {
    if (!silent) setDataLoading(true);

    // The periodic silent refresh only fetches orders changed since the last
    // successful load (relies on the updated_at trigger covering every write
    // path), instead of re-pulling the whole table every cycle. A manual
    // refresh (silent=false, e.g. login or the "刷新" button) always does a
    // full reload so it stays a reliable "get me the real state" escape hatch.
    const isIncremental = silent && lastSyncAtRef.current;

    // 数据范围过滤 (2026-08-20, approved) — non-owner staff only see orders/
    // products/stores belonging to their profiles.store_ids. Reads from the
    // refs (see myRoleRef/myStoreIdsRef above), never the raw state, so
    // every call site gets the current value regardless of which render's
    // closure invoked it. isOwner === true bypasses ALL filtering below —
    // this is the one condition that must never be wrong, so it's checked
    // once here and reused, not re-derived per query.
    const isOwner = myRoleRef.current === "owner";
    // A syntactically-valid but unassignable UUID — used instead of an
    // empty array for .in() so "owner-less / zero stores assigned" reliably
    // returns zero rows via a real WHERE clause, rather than depending on
    // PostgREST's handling of `.in(col, [])` (inconsistent across versions,
    // not worth relying on for an access-control boundary).
    const NO_MATCH_ID = "00000000-0000-0000-0000-000000000000";
    const scopedStoreIds = myStoreIdsRef.current.length > 0 ? myStoreIdsRef.current : [NO_MATCH_ID];

    let ordersQuery = supabaseClient.from("orders").select(ORDER_COLUMNS);
    ordersQuery = isIncremental
      ? ordersQuery.gt("updated_at", lastSyncAtRef.current)
      : ordersQuery.order("order_date", { ascending: false }).limit(5000);
    if (!isOwner) ordersQuery = ordersQuery.in("platform_account_id", scopedStoreIds);

    let accountsQuery = supabaseClient.from("platform_accounts").select("id, platform, account_name, shop_id, created_at, token_expires_at, seller_name, seller_address, seller_phone, logo_url, font_color, font_style, badge_color, shop_note").eq("hidden", false);
    if (!isOwner) accountsQuery = accountsQuery.in("id", scopedStoreIds);

    // Products deliberately NOT store-filtered (2026-08-20) — checked live:
    // all 23 real products have listed_shop_id = null (an unused/legacy
    // column, never actually populated by any real workflow), and this
    // business's real model is one physical SKU listed across multiple
    // stores/platforms at once (confirmed earlier this session — the same
    // SKU appears in order_items across different Shopee shops and TikTok
    // simultaneously), not a SKU "belonging" to exactly one store. Filtering
    // Product Master by listed_shop_id would make it permanently empty for
    // every non-owner regardless of correct store_ids — a regression, not a
    // real access-control boundary. Left unfiltered pending a real decision
    // on what "product access scope" should even mean for this business.
    const productsQuery = supabaseClient.from("products").select("id, sku, name, warehouse_a_qty, warehouse_b_qty, listed_shop_id, location, location_id, price, weight_kg, unit, image_url, category, brand, part_number, barcode, cost_price, status, autocount_item_code");

    const [accountsRes, productsRes, suppliersRes, purchaseOrdersRes, ordersRes, transferLogsRes, warehouseLocationsRes, adjustmentRequestsRes, cancellationRecordsRes] = await Promise.all([
      accountsQuery,
      productsQuery,
      supabaseClient.from("suppliers").select("id, name, contact_person, phone, email, address, payment_terms, status, notes"),
      supabaseClient.from("purchase_orders").select("id, po_no, supplier_id, supplier_name, status, order_date, expected_date, total_amount, notes, purchase_order_items(id, product_id, sku, product_name, qty, unit_cost, subtotal)").order("created_at", { ascending: false }),
      ordersQuery,
      supabaseClient.from("transfer_logs").select("id, type, sku, from_location, to_location, qty, created_at").order("created_at", { ascending: false }),
      supabaseClient.from("warehouse_locations").select("id, parent_id, level, code, name"),
      supabaseClient.from("inventory_adjustment_requests").select("*").order("requested_at", { ascending: false }),
      supabaseClient.from("cancellation_records").select("*").order("requested_at", { ascending: false }),
    ]);

    const changedOrders = ordersRes.data || [];
    const changedOrderIds = changedOrders.map((o) => o.id);
    const itemsByOrder = {};
    if (changedOrderIds.length > 0) {
      const items = await fetchOrderItemsFor(changedOrderIds);
      items.forEach((it) => {
        (itemsByOrder[it.order_id] ||= []).push(it);
      });
    }

    const mappedStores = (accountsRes.data || []).map(mapDbStore);
    const firstShopeeStore = mappedStores.find((s) => s.platform === "Shopee")?.id;
    setStores(mappedStores);
    setInventory((productsRes.data || []).map((p) => mapDbProduct(p, firstShopeeStore)));
    setSuppliers((suppliersRes.data || []).map(mapDbSupplier));
    setPurchaseOrders((purchaseOrdersRes.data || []).map((po) => mapDbPurchaseOrder(po, po.purchase_order_items)));
    setTransferLogs((transferLogsRes.data || []).map(mapDbTransferLog));
    setWarehouseLocations(warehouseLocationsRes.data || []);
    setAdjustmentRequests((adjustmentRequestsRes.data || []).map(mapDbAdjustmentRequest));
    setCancellationRecords((cancellationRecordsRes.data || []).map(mapDbCancellationRecord));

    const mappedChangedOrders = changedOrders.map((o) => mapDbOrder(o, itemsByOrder[o.id] || []));
    if (isIncremental) {
      setOrders((prev) => {
        const byId = new Map(prev.map((o) => [o.id, o]));
        mappedChangedOrders.forEach((o) => byId.set(o.id, o));
        return Array.from(byId.values());
      });
    } else {
      setOrders(mappedChangedOrders);
    }

    const maxUpdatedAt = changedOrders.reduce((max, o) => (o.updated_at > max ? o.updated_at : max), lastSyncAtRef.current || "");
    lastSyncAtRef.current = maxUpdatedAt || new Date().toISOString();

    if (!silent) setDataLoading(false);
  }

  // 2026-08-20: waits for myRole to resolve (not just session) before the
  // first real load — loadRealData below filters by role/store_ids, and
  // firing it while myRole is still null (profile fetch hasn't returned
  // yet) would either show unfiltered data to a non-owner for one frame or
  // require a separate "unknown role" branch. Simplest correct fix: just
  // don't call it until both are known. This effect only fires once more
  // than before (once on session, once when myRole resolves from null to
  // its real value) — not a new poll loop.
  useEffect(() => {
    if (session && myRole !== null) loadRealData();
  }, [session, myRole]);

  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => loadRealData(true), 20000);
    return () => clearInterval(interval);
  }, [session]);

  function transferStock(sku, fromWarehouse, toWarehouse, qty) {
    const item = inventory.find((i) => i.sku === sku);
    if (!item) return;
    const fromKey = fromWarehouse === "吉隆坡仓" ? "warehouseA" : "warehouseB";
    const toKey = toWarehouse === "吉隆坡仓" ? "warehouseA" : "warehouseB";
    const nextA = fromKey === "warehouseA" ? item.warehouseA - qty : toKey === "warehouseA" ? item.warehouseA + qty : item.warehouseA;
    const nextB = fromKey === "warehouseB" ? item.warehouseB - qty : toKey === "warehouseB" ? item.warehouseB + qty : item.warehouseB;

    setInventory((prev) => prev.map((i) => (i.sku === sku ? { ...i, warehouseA: nextA, warehouseB: nextB } : i)));
    setTransferLogs((prev) => [
      { id: `TR-${Date.now()}`, type: "warehouse", sku, from: fromWarehouse, to: toWarehouse, qty, date: new Date().toISOString() },
      ...prev,
    ]);

    supabaseClient.from("products").update({ warehouse_a_qty: nextA, warehouse_b_qty: nextB }).eq("sku", sku)
      .then(({ error }) => error && console.error("transferStock update failed", error));
    supabaseClient.from("transfer_logs").insert({ type: "warehouse", sku, from_location: fromWarehouse, to_location: toWarehouse, qty })
      .then(({ error }) => error && console.error("transfer_logs insert failed", error));

    // stock_movements must stay the single ledger for every stock change, not
    // just order deductions and manual adjustments — so every transfer also
    // gets a paired OUT (source warehouse) + IN (destination warehouse) row,
    // using the same before/after values already computed above.
    const staffEmail = session?.user?.email || null;
    const reason = `调仓：${fromWarehouse} → ${toWarehouse}`;
    supabaseClient.from("products").select("id").eq("sku", sku).maybeSingle().then(({ data: product, error: fetchErr }) => {
      if (fetchErr || !product) { console.error("transferStock: product lookup for ledger failed", fetchErr); return; }
      supabaseClient.from("stock_movements").insert([
        {
          product_id: product.id, sku, movement_type: "transfer_out", warehouse: fromKey === "warehouseA" ? "A" : "B",
          qty_change: -qty, qty_deducted: qty,
          stock_before: fromKey === "warehouseA" ? item.warehouseA : item.warehouseB,
          stock_after: fromKey === "warehouseA" ? nextA : nextB,
          reason, staff_email: staffEmail,
        },
        {
          product_id: product.id, sku, movement_type: "transfer_in", warehouse: toKey === "warehouseA" ? "A" : "B",
          qty_change: qty, qty_deducted: qty,
          stock_before: toKey === "warehouseA" ? item.warehouseA : item.warehouseB,
          stock_after: toKey === "warehouseA" ? nextA : nextB,
          reason, staff_email: staffEmail,
        },
      ]).then(({ error }) => error && console.error("transferStock: stock_movements insert failed", error));
    });
  }

  function moveProductToShop(sku, fromShopId, toShopId) {
    setInventory((prev) => prev.map((item) => (item.sku === sku ? { ...item, listedShop: toShopId } : item)));
    const fromName = stores.find((s) => s.id === fromShopId)?.name || fromShopId;
    const toName = stores.find((s) => s.id === toShopId)?.name || toShopId;
    setTransferLogs((prev) => [
      { id: `SM-${Date.now()}`, type: "shop", sku, from: fromName, to: toName, qty: null, date: new Date().toISOString() },
      ...prev,
    ]);

    supabaseClient.from("products").update({ listed_shop_id: toShopId }).eq("sku", sku)
      .then(({ error }) => error && console.error("moveProductToShop update failed", error));
    supabaseClient.from("transfer_logs").insert({ type: "shop", sku, from_location: fromName, to_location: toName, qty: null })
      .then(({ error }) => error && console.error("transfer_logs insert failed", error));
  }

  function updateProductLocation(sku, location) {
    setInventory((prev) => prev.map((item) => (item.sku === sku ? { ...item, location } : item)));
    supabaseClient.from("products").update({ location }).eq("sku", sku)
      .then(({ error }) => error && console.error("updateProductLocation failed", error));
  }

  // Manual stock-in / stock-out / adjustment — the non-order counterpart to
  // deductStockForPrintedItem. Writes the same stock_movements ledger (now
  // extended with movement_type/qty_change/reason/staff_email/warehouse) so
  // there's one place to see every reason warehouse_a_qty/b_qty ever
  // changed, order-triggered or manual. Doesn't touch warehouse_stage, the
  // reserved-qty calculation, or order_status at all — this only ever moves
  // products.warehouse_a_qty/warehouse_b_qty, the same fields ProductMove's
  // transferStock and the print/pack deduction path already write.
  async function recordStockMovement({ sku, movementType, warehouse, qty, targetQty, reason }) {
    const { data: product, error: fetchErr } = await supabaseClient
      .from("products")
      .select("id, warehouse_a_qty, warehouse_b_qty")
      .eq("sku", sku)
      .maybeSingle();
    if (fetchErr || !product) return { error: fetchErr?.message || "商品不存在" };

    const stockBefore = warehouse === "B" ? (product.warehouse_b_qty || 0) : (product.warehouse_a_qty || 0);
    let qtyChange;
    if (movementType === "stock_in") qtyChange = Math.abs(Number(qty) || 0);
    else if (movementType === "stock_out") qtyChange = -Math.min(Math.abs(Number(qty) || 0), stockBefore);
    else qtyChange = (Number(targetQty) || 0) - stockBefore; // adjustment: target is the counted absolute qty

    const stockAfter = Math.max(stockBefore + qtyChange, 0);
    const staffEmail = session?.user?.email || null;
    const productField = warehouse === "B" ? "warehouse_b_qty" : "warehouse_a_qty";

    const { error: updateErr } = await supabaseClient.from("products").update({ [productField]: stockAfter }).eq("id", product.id);
    if (updateErr) return { error: updateErr.message };

    const { error: logErr } = await supabaseClient.from("stock_movements").insert({
      product_id: product.id,
      sku,
      movement_type: movementType,
      qty_change: qtyChange,
      qty_deducted: Math.abs(qtyChange),
      stock_before: stockBefore,
      stock_after: stockAfter,
      warehouse,
      reason: reason || null,
      staff_email: staffEmail,
    });
    if (logErr) { console.error("recordStockMovement log failed", logErr); return { error: logErr.message }; }

    setInventory((prev) =>
      prev.map((item) => (item.sku === sku ? { ...item, [warehouse === "B" ? "warehouseB" : "warehouseA"]: stockAfter } : item)),
    );
    return { error: null };
  }

  // Inventory Adjustment (approval-gated request, not a direct write). Per
  // the AutoCount-is-sole-Physical-Stock-Master direction, this never touches
  // products.warehouse_a_qty/b_qty itself — it only records the request and,
  // once owner-approved, marks autocount_sync_status='pending' for a future
  // real AutoCount sync. Fully separate from recordStockMovement above,
  // which stays as-is for its own direct stock_in/out/transfer/adjustment
  // writes.
  async function createAdjustmentRequest({ sku, qtyChange, reason }) {
    const product = inventory.find((i) => i.sku === sku);
    const { error } = await supabaseClient.from("inventory_adjustment_requests").insert({
      product_id: product?.id || null,
      sku,
      qty_change: Number(qtyChange) || 0,
      reason,
      requested_by: session?.user?.email || null,
    });
    if (error) return { error: error.message };
    await loadRealData(true);
    return { error: null };
  }

  async function approveAdjustmentRequest(id) {
    const { error } = await supabaseClient.from("inventory_adjustment_requests")
      .update({ status: "approved", approved_by: session?.user?.email || null, approved_at: new Date().toISOString(), autocount_sync_status: "pending" })
      .eq("id", id);
    if (error) { console.error("approveAdjustmentRequest failed", error); return { error: error.message }; }
    setAdjustmentRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: "approved", approvedBy: session?.user?.email || null, autocountSyncStatus: "pending" } : r)));
    return { error: null };
  }

  async function rejectAdjustmentRequest(id) {
    const { error } = await supabaseClient.from("inventory_adjustment_requests")
      .update({ status: "rejected", approved_by: session?.user?.email || null, approved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) { console.error("rejectAdjustmentRequest failed", error); return { error: error.message }; }
    setAdjustmentRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: "rejected", approvedBy: session?.user?.email || null } : r)));
    return { error: null };
  }

  // Order Cancellation Management. Deliberately never writes order_status
  // (frozen — see DB_TO_DEMO_STATUS) or deletes the order; cancel_stage is a
  // fully separate lifecycle (null -> 'requested' -> 'cancelled') and
  // cancellation_records is the append-only audit trail, kept even for
  // orders already sent to AutoCount (autocount_doc_no carried over from the
  // order for manual DO rollback follow-up).
  async function requestOrderCancellation(orderId, reason) {
    const { data: dbOrder, error: fetchErr } = await supabaseClient
      .from("orders")
      .select("id, order_no, platform, autocount_doc_no, buyer_name")
      .eq("order_no", orderId)
      .maybeSingle();
    if (fetchErr || !dbOrder) return { error: fetchErr?.message || "订单不存在" };
    if (!["shopee", "tiktok"].includes(dbOrder.platform)) return { error: "只支持 Shopee/TikTok 订单取消" };

    const order = orders.find((o) => o.id === orderId);
    const { error: recErr } = await supabaseClient.from("cancellation_records").insert({
      order_id: dbOrder.id,
      order_no: dbOrder.order_no,
      channel: dbOrder.platform,
      sku: order?.sku || "",
      product_name: order?.product || "",
      qty: order?.qty || 1,
      customer_name: dbOrder.buyer_name || "",
      reason,
      autocount_doc_no: dbOrder.autocount_doc_no || null,
      requested_by: session?.user?.email || null,
    });
    if (recErr) return { error: recErr.message };

    const { error: stageErr } = await supabaseClient.from("orders").update({ cancel_stage: "requested" }).eq("order_no", orderId);
    if (stageErr) return { error: stageErr.message };

    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, cancelStage: "requested" } : o)));
    await loadRealData(true);
    return { error: null };
  }

  async function finalizeOrderCancellation(recordId, orderId) {
    const { error: recErr } = await supabaseClient.from("cancellation_records").update({ cancelled_at: new Date().toISOString() }).eq("id", recordId);
    if (recErr) { console.error("finalizeOrderCancellation record update failed", recErr); return { error: recErr.message }; }

    const { error: stageErr } = await supabaseClient.from("orders").update({ cancel_stage: "cancelled" }).eq("order_no", orderId);
    if (stageErr) { console.error("finalizeOrderCancellation stage update failed", stageErr); return { error: stageErr.message }; }

    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, cancelStage: "cancelled" } : o)));
    setCancellationRecords((prev) => prev.map((r) => (r.id === recordId ? { ...r, cancelledAt: new Date().toISOString() } : r)));
    return { error: null };
  }

  // Warehouse location hierarchy (warehouse -> zone -> shelf -> bin). The two
  // warehouse-level rows are seeded once by migration and aren't editable
  // here (they're the same two places warehouse_a_qty/b_qty already track);
  // this only creates/removes zones/shelves/bins under them.
  async function createWarehouseLocation({ parentId, level, code, name }) {
    const { data, error } = await supabaseClient
      .from("warehouse_locations")
      .insert({ parent_id: parentId, level, code, name })
      .select("id, parent_id, level, code, name")
      .single();
    if (error || !data) return { error: error?.message };
    setWarehouseLocations((prev) => [...prev, data]);
    return { error: null, location: data };
  }

  async function deleteWarehouseLocation(id) {
    const { error } = await supabaseClient.from("warehouse_locations").delete().eq("id", id);
    if (error) return { error: error.message };
    // ON DELETE CASCADE removes descendants server-side; drop this node and
    // any of its descendants from local state the same way.
    setWarehouseLocations((prev) => {
      const removed = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        prev.forEach((loc) => {
          if (loc.parent_id && removed.has(loc.parent_id) && !removed.has(loc.id)) {
            removed.add(loc.id);
            changed = true;
          }
        });
      }
      return prev.filter((loc) => !removed.has(loc.id));
    });
    return { error: null };
  }

  // Binds a SKU to a specific bin (location_id) — separate from the older
  // free-text products.location field, which is left untouched.
  function bindProductLocation(sku, locationId) {
    setInventory((prev) => prev.map((item) => (item.sku === sku ? { ...item, locationId } : item)));
    supabaseClient.from("products").update({ location_id: locationId }).eq("sku", sku)
      .then(({ error }) => error && console.error("bindProductLocation failed", error));
  }

  // Product Master CRUD — internal SKU catalog only (name/price/weight/unit/
  // image). Stock quantities aren't editable here: ProductMove already owns
  // warehouse-to-warehouse transfers (with a logged trail via transfer_logs),
  // so letting this page also mutate warehouse_a_qty/b_qty directly would
  // create a second, unaudited way to change stock. The one exception is a
  // brand-new SKU's starting quantity, set once at creation.
  async function createProduct({ sku, name, price, weightKg, unit, imageUrl, initialStock, category, brand, partNumber, barcode, costPrice, status, autocountItemCode }) {
    const { error } = await supabaseClient.from("products").insert({
      sku,
      name,
      price: price || 0,
      weight_kg: weightKg || 0,
      unit: unit || "pcs", // products.unit is NOT NULL (db default 'pcs'), but an
      // explicit null in the insert bypasses that column default, so this
      // has to be spelled out here rather than left to fall through.
      image_url: imageUrl || null,
      warehouse_a_qty: initialStock || 0,
      warehouse_b_qty: 0,
      category: category || null,
      brand: brand || null,
      part_number: partNumber || null,
      barcode: barcode || null,
      cost_price: costPrice || 0,
      status: status || "active",
      autocount_item_code: autocountItemCode || null,
    });
    if (error) return { error: error.message };
    setInventory((prev) => [
      ...prev,
      {
        sku, name, warehouseA: initialStock || 0, warehouseB: 0, reorderPoint: 20,
        shopeeLinked: true, tiktokLinked: true, listedShop: null, location: "",
        price: price || 0, weightKg: weightKg || 0, unit: unit || "", imageUrl: imageUrl || null,
        category: category || "", brand: brand || "", partNumber: partNumber || "",
        barcode: barcode || "", costPrice: costPrice || 0, status: status || "active",
        autocountItemCode: autocountItemCode || "",
      },
    ]);
    return { error: null };
  }

  async function updateProductMaster(sku, fields) {
    // Only include keys actually present in `fields` — this function is used
    // both for full-form saves (all keys present) and lightweight partial
    // updates like a status-only toggle (one key present). Defaulting an
    // absent key to null/"pcs"/0 here would silently wipe that column on
    // every partial-update call, not just leave it unset.
    const payload = {};
    if ("name" in fields) payload.name = fields.name;
    if ("price" in fields) payload.price = fields.price;
    if ("weightKg" in fields) payload.weight_kg = fields.weightKg;
    if ("unit" in fields) payload.unit = fields.unit || "pcs";
    if ("imageUrl" in fields) payload.image_url = fields.imageUrl || null;
    if ("category" in fields) payload.category = fields.category || null;
    if ("brand" in fields) payload.brand = fields.brand || null;
    if ("partNumber" in fields) payload.part_number = fields.partNumber || null;
    if ("barcode" in fields) payload.barcode = fields.barcode || null;
    if ("costPrice" in fields) payload.cost_price = fields.costPrice || 0;
    if ("status" in fields) payload.status = fields.status || "active";
    if ("autocountItemCode" in fields) payload.autocount_item_code = fields.autocountItemCode || null;

    const { error } = await supabaseClient
      .from("products")
      .update(payload)
      .eq("sku", sku);
    if (error) { console.error("updateProductMaster failed", error); return { error: error.message }; }
    setInventory((prev) => prev.map((item) => (item.sku === sku ? { ...item, ...fields } : item)));
    return { error: null };
  }

  async function deleteProduct(sku) {
    const { error } = await supabaseClient.from("products").delete().eq("sku", sku);
    if (error) { console.error("deleteProduct failed", error); return { error: error.message }; }
    setInventory((prev) => prev.filter((item) => item.sku !== sku));
    return { error: null };
  }

  // Supplier Master CRUD — same shape as Product Master's. Not linked to
  // products.supplier_id from any UI yet (explicitly deferred).
  async function createSupplier({ name, contactPerson, phone, email, address, paymentTerms, notes, status }) {
    const { data, error } = await supabaseClient
      .from("suppliers")
      .insert({
        name,
        contact_person: contactPerson || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        payment_terms: paymentTerms || null,
        notes: notes || null,
        status: status || "active",
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    setSuppliers((prev) => [
      ...prev,
      { id: data.id, name, contactPerson: contactPerson || "", phone: phone || "", email: email || "", address: address || "", paymentTerms: paymentTerms || "", notes: notes || "", status: status || "active" },
    ]);
    return { error: null };
  }

  async function updateSupplier(id, fields) {
    // Same partial-update-safe pattern as updateProductMaster: only include a
    // key if it was actually passed, so a future single-field call (e.g. a
    // status toggle) can never silently null out the rest of the row.
    const payload = {};
    if ("name" in fields) payload.name = fields.name;
    if ("contactPerson" in fields) payload.contact_person = fields.contactPerson || null;
    if ("phone" in fields) payload.phone = fields.phone || null;
    if ("email" in fields) payload.email = fields.email || null;
    if ("address" in fields) payload.address = fields.address || null;
    if ("paymentTerms" in fields) payload.payment_terms = fields.paymentTerms || null;
    if ("notes" in fields) payload.notes = fields.notes || null;
    if ("status" in fields) payload.status = fields.status || "active";

    const { error } = await supabaseClient.from("suppliers").update(payload).eq("id", id);
    if (error) { console.error("updateSupplier failed", error); return { error: error.message }; }
    setSuppliers((prev) => prev.map((s) => (s.id === id ? { ...s, ...fields } : s)));
    return { error: null };
  }

  async function deleteSupplier(id) {
    const { error } = await supabaseClient.from("suppliers").delete().eq("id", id);
    if (error) { console.error("deleteSupplier failed", error); return { error: error.message }; }
    setSuppliers((prev) => prev.filter((s) => s.id !== id));
    return { error: null };
  }

  // Purchase Order CRUD — Phase 1, pure record-keeping. Saving only ever
  // writes to purchase_orders/purchase_order_items; status changes (incl.
  // "received") never touch products/stock_movements/orders.
  // po_no uniqueness is enforced by a DB constraint (not just the frontend's
  // suggested-number generator), so a collision surfaces as a raw Postgres
  // 23505 error here — translated to a readable message for staff.
  function friendlyPoError(err) {
    if (err.code === "23505") return t("PO 编号已存在，请更换编号", "This PO No. already exists — please use a different one");
    return err.message;
  }

  async function createPurchaseOrder({ poNo, supplierId, supplierName, orderDate, expectedDate, notes, items }) {
    const totalAmount = items.reduce((sum, it) => sum + it.qty * it.unitCost, 0);
    const { data: po, error: poErr } = await supabaseClient
      .from("purchase_orders")
      .insert({
        po_no: poNo,
        supplier_id: supplierId,
        supplier_name: supplierName,
        order_date: orderDate,
        expected_date: expectedDate || null,
        notes: notes || null,
        total_amount: totalAmount,
        created_by: session?.user?.email || null,
      })
      .select("id")
      .single();
    if (poErr) return { error: friendlyPoError(poErr) };

    const { error: itemsErr } = await supabaseClient.from("purchase_order_items").insert(
      items.map((it) => ({
        purchase_order_id: po.id,
        product_id: it.productId,
        sku: it.sku,
        product_name: it.productName,
        qty: it.qty,
        unit_cost: it.unitCost,
        subtotal: it.qty * it.unitCost,
      }))
    );
    if (itemsErr) {
      await supabaseClient.from("purchase_orders").delete().eq("id", po.id); // best-effort rollback, keeps an item failure from leaving an empty orphan PO
      return { error: itemsErr.message };
    }

    setPurchaseOrders((prev) => [
      {
        id: po.id, poNo, supplierId, supplierName, status: "draft", orderDate, expectedDate: expectedDate || "",
        totalAmount, notes: notes || "",
        items: items.map((it) => ({ ...it, subtotal: it.qty * it.unitCost })),
      },
      ...prev,
    ]);
    return { error: null };
  }

  async function updatePurchaseOrder(id, { poNo, supplierId, supplierName, orderDate, expectedDate, notes, items }) {
    const totalAmount = items.reduce((sum, it) => sum + it.qty * it.unitCost, 0);
    const { error: poErr } = await supabaseClient
      .from("purchase_orders")
      .update({
        po_no: poNo,
        supplier_id: supplierId,
        supplier_name: supplierName,
        order_date: orderDate,
        expected_date: expectedDate || null,
        notes: notes || null,
        total_amount: totalAmount,
      })
      .eq("id", id);
    if (poErr) return { error: friendlyPoError(poErr) };

    // Items are replaced wholesale on every edit (delete all, insert the
    // current set) rather than diffed row-by-row — simplest correct approach
    // for Phase 1's scope, since line items have no independent lifecycle
    // outside their parent PO.
    const { error: delErr } = await supabaseClient.from("purchase_order_items").delete().eq("purchase_order_id", id);
    if (delErr) return { error: delErr.message };

    const { error: insErr } = await supabaseClient.from("purchase_order_items").insert(
      items.map((it) => ({
        purchase_order_id: id,
        product_id: it.productId,
        sku: it.sku,
        product_name: it.productName,
        qty: it.qty,
        unit_cost: it.unitCost,
        subtotal: it.qty * it.unitCost,
      }))
    );
    if (insErr) return { error: insErr.message };

    setPurchaseOrders((prev) => prev.map((po) => (po.id === id
      ? { ...po, poNo, supplierId, supplierName, orderDate, expectedDate: expectedDate || "", notes: notes || "", totalAmount, items: items.map((it) => ({ ...it, subtotal: it.qty * it.unitCost })) }
      : po)));
    return { error: null };
  }

  async function updatePurchaseOrderStatus(id, status) {
    const { error } = await supabaseClient.from("purchase_orders").update({ status }).eq("id", id);
    if (error) { console.error("updatePurchaseOrderStatus failed", error); return { error: error.message }; }
    setPurchaseOrders((prev) => prev.map((po) => (po.id === id ? { ...po, status } : po)));
    return { error: null };
  }

  async function deletePurchaseOrder(id) {
    const { error } = await supabaseClient.from("purchase_orders").delete().eq("id", id);
    if (error) { console.error("deletePurchaseOrder failed", error); return { error: error.message }; }
    setPurchaseOrders((prev) => prev.filter((po) => po.id !== id));
    return { error: null };
  }

  // Registers a goods receipt against a PO — separate from and never
  // triggered by the PO's own status buttons. Only ever writes
  // stock_movements (with purchase_order_id/purchase_order_item_id set)
  // and products.warehouse_a_qty/b_qty, same as recordStockMovement.
  async function registerReceiving({ purchaseOrderId, warehouse, lines }) {
    const productField = warehouse === "B" ? "warehouse_b_qty" : "warehouse_a_qty";
    for (const line of lines) {
      if (!line.qty || line.qty <= 0) continue;
      const { data: product, error: fetchErr } = await supabaseClient
        .from("products")
        .select("id, warehouse_a_qty, warehouse_b_qty")
        .eq("id", line.productId)
        .maybeSingle();
      if (fetchErr || !product) return { error: fetchErr?.message || "商品不存在" };

      const stockBefore = warehouse === "B" ? (product.warehouse_b_qty || 0) : (product.warehouse_a_qty || 0);
      const stockAfter = stockBefore + line.qty;

      const { error: updateErr } = await supabaseClient.from("products").update({ [productField]: stockAfter }).eq("id", product.id);
      if (updateErr) return { error: updateErr.message };

      const { error: logErr } = await supabaseClient.from("stock_movements").insert({
        product_id: product.id,
        sku: line.sku,
        movement_type: "stock_in",
        qty_change: line.qty,
        qty_deducted: line.qty,
        stock_before: stockBefore,
        stock_after: stockAfter,
        warehouse,
        reason: "PO 收货",
        staff_email: session?.user?.email || null,
        purchase_order_id: purchaseOrderId,
        purchase_order_item_id: line.purchaseOrderItemId,
      });
      if (logErr) { console.error("registerReceiving log failed", logErr); return { error: logErr.message }; }

      setInventory((prev) => prev.map((item) => (item.sku === line.sku ? { ...item, [warehouse === "B" ? "warehouseB" : "warehouseA"]: stockAfter } : item)));
    }
    return { error: null };
  }

  // Persists the connection to platform_accounts (platform + shop_id has a DB
  // unique constraint already in place — a duplicate insert is rejected and
  // rolled back from local state below). shop_id has no real OAuth-issued
  // value yet (no live API access), so a slug of the store name stands in
  // for it until a real integration supplies one. access_token/refresh_token
  // are never selected back into the frontend anywhere (loadRealData's
  // platform_accounts query doesn't include those columns), so nothing here
  // renders them.
  function connectStore(name, platform, syncMode = "manual") {
    const tempId = `store-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const connectedAt = new Date().toISOString().slice(0, 10);
    setStores((prev) => [...prev, { id: tempId, platform, name, connectedAt, status: "已连接", syncMode }]);

    const dbPlatform = DEMO_TO_DB_PLATFORM[platform] || "shopee";
    const shopId = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || null;
    const payload = {
      platform: dbPlatform,
      account_name: name,
      shop_id: shopId,
      access_token: null,
      refresh_token: null,
      status: "connected",
      last_synced_at: null,
    };
    if (syncMode === "api") payload.token_expires_at = new Date(Date.now() + 365 * 86400000).toISOString();

    supabaseClient.from("platform_accounts").insert(payload).select("id, created_at").single()
      .then(({ data, error }) => {
        if (error || !data) {
          console.error("connectStore failed", error);
          setStores((prev) => prev.filter((s) => s.id !== tempId)); // duplicate (platform+shop_id) or other DB error — drop the optimistic entry
          return;
        }
        setStores((prev) => prev.map((s) => (s.id === tempId ? { ...s, id: data.id, connectedAt: (data.created_at || "").slice(0, 10) } : s)));
      });
  }

  function setStoreSyncMode(storeId, mode) {
    setStores((prev) => prev.map((s) => (s.id === storeId ? { ...s, syncMode: mode } : s)));
  }

  // Seller (sender) info printed on shipping labels — kept per-shop so a
  // multi-store account prints the right sender for each order automatically
  // (resolved by the order's platform_account_id in the Label Printing module).
  function updateStoreSellerInfo(storeId, { name, address, phone }) {
    setStores((prev) =>
      prev.map((s) => (s.id === storeId ? { ...s, sellerName: name, sellerAddress: address, sellerPhone: phone } : s)),
    );
    supabaseClient
      .from("platform_accounts")
      .update({ seller_name: name, seller_address: address, seller_phone: phone })
      .eq("id", storeId)
      .then(({ error }) => error && console.error("updateStoreSellerInfo failed", error));
  }

  // Store display name (platform_accounts.account_name) shown on the store
  // list cards — separate from seller info above (that's for shipping label
  // sender text). Only touches account_name; token/shop_id/status/hidden and
  // any sync logic are untouched.
  function updateStoreName(storeId, name) {
    setStores((prev) => prev.map((s) => (s.id === storeId ? { ...s, name } : s)));
    supabaseClient
      .from("platform_accounts")
      .update({ account_name: name })
      .eq("id", storeId)
      .then(({ error }) => error && console.error("updateStoreName failed", error));
  }

  // Store card appearance (logo/font color+style/badge color/note) — cosmetic
  // only, same pattern as updateStoreName above. Never touches token,
  // shop_id, status, hidden, orders, or any sync/cron logic.
  function updateStoreAppearance(storeId, { logoUrl, fontColor, fontStyle, badgeColor, shopNote }) {
    setStores((prev) =>
      prev.map((s) => (s.id === storeId ? { ...s, logoUrl, fontColor, fontStyle, badgeColor, shopNote } : s)),
    );
    supabaseClient
      .from("platform_accounts")
      .update({ logo_url: logoUrl, font_color: fontColor, font_style: fontStyle, badge_color: badgeColor, shop_note: shopNote })
      .eq("id", storeId)
      .then(({ error }) => error && console.error("updateStoreAppearance failed", error));
  }

  async function importOrders(newOrders) {
    setOrders((prev) => [...newOrders, ...prev]);

    const orderRows = newOrders.map((o) => ({
      platform: DEMO_TO_DB_PLATFORM[o.platform] || "shopee",
      platform_account_id: o.shop,
      order_no: o.id,
      buyer_name: o.customer,
      buyer_phone: o.phone,
      shipping_address: o.address,
      tracking_no: o.tracking && o.tracking !== "—" ? o.tracking : null,
      order_status: "pending",
      shipping_fee: o.shippingFee,
      total_amount: +(o.unitPrice * o.qty).toFixed(2),
      order_date: o.date,
      updated_at: new Date().toISOString(),
    }));
    const { data: insertedOrders, error } = await supabaseClient
      .from("orders")
      .upsert(orderRows, { onConflict: "platform,order_no" })
      .select("id, order_no");
    if (error || !insertedOrders) return;

    const idByOrderNo = {};
    insertedOrders.forEach((row) => { idByOrderNo[row.order_no] = row.id; });
    const itemRows = newOrders
      .filter((o) => idByOrderNo[o.id])
      .map((o) => ({
        order_id: idByOrderNo[o.id],
        sku: o.sku,
        product_name: o.product,
        qty: o.qty,
        unit_price: o.unitPrice,
        subtotal: +(o.unitPrice * o.qty).toFixed(2),
      }));
    if (itemRows.length > 0) {
      await supabaseClient.from("order_items").upsert(itemRows, { onConflict: "order_id,sku" });
    }
  }

  function updateOrderStatus(orderId, newStatus) {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)));
    setSelectedOrder((prev) => (prev && prev.id === orderId ? { ...prev, status: newStatus } : prev));
    const dbStatus = DEMO_TO_DB_STATUS[newStatus];
    if (dbStatus) {
      supabaseClient.from("orders").update({ order_status: dbStatus }).eq("order_no", orderId)
        .then(({ error }) => error && console.error("updateOrderStatus failed", error));
    }
  }

  function updateOrderNote(orderId, color, text) {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, noteColor: color, noteText: text } : o)));
    supabaseClient.from("orders").update({ note_color: color, note_text: text }).eq("order_no", orderId)
      .then(({ error }) => error && console.error("updateOrderNote failed", error));
  }

  // Printing a shipping label bumps print_count and advances warehouse_stage
  // to 'printed' — it does NOT touch order_status. Matches Shopee Seller
  // Centre: printing a To-Process order keeps it at To Process; only an
  // explicit Confirm Process action (see confirmProcess below) moves it to
  // Processed. This used to also flip order_status pending -> processing on
  // print, which was wrong — fixed 2026-07-28 per explicit report. Stock is
  // NOT deducted here either — printing a label doesn't mean the item has
  // actually left the shelf yet, so the real deduction happens in
  // markPacked (picked -> ready_ship), the point where packing is actually
  // done. See markPacked for the deductStockForPrintedItem call.
  async function handlePrintConfirm(orderNos, templateDataByOrderId) {
    const { data: dbOrders, error: fetchErr } = await supabaseClient
      .from("orders")
      .select("id, order_no, platform, order_status, platform_status, print_count, warehouse_stage")
      .in("order_no", orderNos);
    if (fetchErr || !dbOrders || dbOrders.length === 0) return;

    // Print history — one row per order actually printed, independent of
    // the order_status/warehouse_stage/print_count transitions below (never
    // blocks or gets blocked by them). template_data intentionally excludes
    // recipient PII (see print_history migration comment); templateDataByOrderId
    // is keyed by the frontend order.id, which is order_no, same as orderNos.
    if (templateDataByOrderId) {
      supabaseClient
        .from("print_history")
        .insert(
          dbOrders.map((o) => ({
            order_id: o.id,
            platform: o.platform,
            template_data: templateDataByOrderId[o.order_no] || {},
          })),
        )
        .then(({ error }) => error && console.error("print_history insert failed", error));
    }

    const printedAt = new Date().toISOString();
    const printedBy = session?.user?.email || null;
    // warehouse_stage is a separate field from order_status (see migration
    // comment: order_status gets overwritten by every TikTok/Shopee sync
    // run, so the warehouse pipeline can't live there). Only orders still at
    // the very start of the pipeline advance to 'printed' — a reprint of an
    // already-picked/packed order doesn't regress its stage.
    const toPrintedIds = dbOrders.filter((o) => o.warehouse_stage === "pending").map((o) => o.id);
    if (toPrintedIds.length > 0) {
      supabaseClient.from("orders").update({ warehouse_stage: "printed" }).in("id", toPrintedIds)
        .then(({ error }) => error && console.error("print: warehouse_stage -> printed failed", error));
      supabaseClient
        .from("warehouse_action_log")
        .insert(toPrintedIds.map((id) => ({ order_id: id, action: "printed", from_stage: "pending", to_stage: "printed", staff_email: printedBy })))
        .then(({ error }) => error && console.error("warehouse_action_log insert (printed) failed", error));
    }

    dbOrders.forEach((o) => {
      supabaseClient
        .from("orders")
        .update({ print_count: (o.print_count || 0) + 1, last_printed_at: printedAt, last_printed_by: printedBy })
        .eq("id", o.id)
        .then(({ error }) => error && console.error("incrementPrintCount failed", error));
    });

    const toPrintedOrderNos = new Set(dbOrders.filter((o) => toPrintedIds.includes(o.id)).map((o) => o.order_no));
    setOrders((prev) =>
      prev.map((o) =>
        orderNos.includes(o.id)
          ? {
              ...o,
              printCount: (o.printCount || 0) + 1,
              lastPrintedAt: printedAt,
              lastPrintedBy: printedBy,
              warehouseStage: toPrintedOrderNos.has(o.id) ? "printed" : o.warehouseStage,
            }
          : o,
      ),
    );

    dbOrders.forEach((o) => syncFulfillmentToPlatform(o));
  }

  // Confirm Process — the only thing that actually moves order_status from
  // pending to processing now (see handlePrintConfirm above, which no
  // longer does this). Matches Shopee Seller Centre's explicit "Confirm
  // Process" button. Only orders still at 'pending' are touched — calling
  // this on an already-processing order is a silent no-op, same convention
  // as markPicked/markPacked. Doesn't touch warehouse_stage, print_count,
  // or stock — entirely independent of printing, on purpose.
  async function confirmProcess(orderNos) {
    const { data: dbOrders, error } = await supabaseClient
      .from("orders")
      .select("id, order_no")
      .in("order_no", orderNos)
      .eq("order_status", "pending");
    if (error || !dbOrders || dbOrders.length === 0) return;

    const ids = dbOrders.map((o) => o.id);
    const { error: updateErr } = await supabaseClient.from("orders").update({ order_status: "processing" }).in("id", ids);
    if (updateErr) { console.error("confirmProcess failed", updateErr); return; }

    const orderNoSet = new Set(dbOrders.map((o) => o.order_no));
    setOrders((prev) => prev.map((o) => (orderNoSet.has(o.id) ? { ...o, orderStatus: "processing" } : o)));
  }

  // Batch warehouse actions (Warehouse page) — take order_no values, same
  // convention as handlePrintConfirm. Each only advances orders actually at
  // the expected prior stage, logs one warehouse_action_log row per order,
  // and never touches order_status or the platform sync tables.
  // Accepts orders at 'pending' (Order Management Center's new 拣货完成
  // button, picking happens before printing) or 'printed' (Warehouse page's
  // existing flow, picking happens after printing) — both are valid prior
  // stages, picking itself doesn't care which one came first.
  async function markPicked(orderNos) {
    const { data: dbOrders, error } = await supabaseClient
      .from("orders")
      .select("id, order_no, warehouse_stage")
      .in("order_no", orderNos)
      .in("warehouse_stage", ["pending", "printed"]);
    if (error || !dbOrders || dbOrders.length === 0) return;

    const ids = dbOrders.map((o) => o.id);
    const staffEmail = session?.user?.email || null;
    const { error: updateErr } = await supabaseClient.from("orders").update({ warehouse_stage: "picked" }).in("id", ids);
    if (updateErr) { console.error("markPicked failed", updateErr); return; }

    await supabaseClient
      .from("warehouse_action_log")
      .insert(dbOrders.map((o) => ({ order_id: o.id, action: "picked", from_stage: o.warehouse_stage, to_stage: "picked", staff_email: staffEmail })))
      .then(({ error: logErr }) => logErr && console.error("warehouse_action_log insert (picked) failed", logErr));

    const orderNoSet = new Set(dbOrders.map((o) => o.order_no));
    setOrders((prev) => prev.map((o) => (orderNoSet.has(o.id) ? { ...o, warehouseStage: "picked" } : o)));
  }

  async function markPacked(orderNos) {
    const { data: dbOrders, error } = await supabaseClient
      .from("orders")
      .select("id, order_no, platform, order_status, platform_status")
      .in("order_no", orderNos)
      .eq("warehouse_stage", "picked");
    if (error || !dbOrders || dbOrders.length === 0) return;

    const ids = dbOrders.map((o) => o.id);
    const staffEmail = session?.user?.email || null;
    const { error: updateErr } = await supabaseClient.from("orders").update({ warehouse_stage: "ready_ship" }).in("id", ids);
    if (updateErr) { console.error("markPacked failed", updateErr); return; }

    // Packing complete also advances the business-facing order_status
    // pending -> processing (mirrors confirmProcess's own pending-only gate)
    // so ERP status reflects that the order has actually moved, not just
    // the warehouse-internal stage.
    const pendingIds = dbOrders.filter((o) => o.order_status === "pending").map((o) => o.id);
    if (pendingIds.length > 0) {
      const { error: statusErr } = await supabaseClient.from("orders").update({ order_status: "processing" }).in("id", pendingIds);
      if (statusErr) console.error("markPacked order_status update failed", statusErr);
    }

    await supabaseClient
      .from("warehouse_action_log")
      .insert(ids.map((id) => ({ order_id: id, action: "packed", from_stage: "picked", to_stage: "ready_ship", staff_email: staffEmail })))
      .then(({ error: logErr }) => logErr && console.error("warehouse_action_log insert (packed) failed", logErr));

    // Push shipment to Shopee for orders reaching ready_ship (Phase 2,
    // approved 2026-08-11) — fire-and-forget, doesn't block the UI. All
    // Shopee API logic, idempotency, and error handling live entirely in
    // the edge function; this call site only decides WHEN to ask it to try.
    // On success (2026-08-17, explicitly authorized) the edge function also
    // writes orders.platform_status=PROCESSED and returns it back here, so
    // the local order list reflects the shipment immediately instead of
    // waiting for the next cron sync — cron still re-syncs Shopee's real
    // status afterwards regardless, this is a display-latency fix only.
    dbOrders
      .filter((o) => o.platform === "shopee")
      .forEach((o) => {
        supabaseClient.functions.invoke("shopee-push-fulfillment", { body: { orderId: o.id } })
          .then(({ data: pushData, error: pushErr }) => {
            if (pushErr) { console.error("shopee-push-fulfillment invoke failed", pushErr); return; }
            if (pushData?.success && pushData.platformStatus) {
              setOrders((prev) => prev.map((row) => (row.id === o.order_no ? { ...row, platformStatus: pushData.platformStatus } : row)));
            }
          });
      });

    const orderNoSet = new Set(dbOrders.map((o) => o.order_no));
    const pendingOrderNoSet = new Set(dbOrders.filter((o) => o.order_status === "pending").map((o) => o.order_no));
    setOrders((prev) => prev.map((o) => (orderNoSet.has(o.id) ? { ...o, warehouseStage: "ready_ship", orderStatus: pendingOrderNoSet.has(o.id) ? "processing" : o.orderStatus } : o)));

    // Packing complete is the real "item left the shelf" moment, so this is
    // where stock actually gets deducted (moved here from handlePrintConfirm
    // — see its comment). deductStockForPrintedItem itself is unchanged:
    // same idempotent stock_movements insert-then-update pattern.
    const items = await fetchOrderItemsFor(ids);
    const orderById = new Map(dbOrders.map((o) => [o.id, o]));
    for (const item of items) {
      const order = orderById.get(item.order_id);
      if (order) await deductStockForPrintedItem(order, item);
    }
  }

  if (session === undefined) {
    return (
      <div className="min-h-screen w-full bg-slate-50 flex items-center justify-center text-slate-400 text-sm">
        {t("正在检查登录状态…", "Checking login status…")}
      </div>
    );
  }

  if (!session) {
    return <LoginScreen t={t} />;
  }

  if (dataLoading) {
    return (
      <div className="min-h-screen w-full bg-slate-50 flex items-center justify-center text-slate-400 text-sm">
        {t("正在读取数据…", "Loading data…")}
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900 flex">
      <style>{`
        @media print {
          /* Named page so only the shipping label prints on 100mm x 150mm
             thermal stock — the warehouse picking list (variable row count)
             keeps the browser's default page size instead. */
          @page shipping-label { size: 100mm 150mm; margin: 0; }
          .print-slip-shipping { page: shipping-label; }
          body * { visibility: hidden; }
          .print-slip, .print-slip * { visibility: visible; }
          /* !important is required here, not stylistic: PrintSlip renders
             this div with an inline style (position:absolute; left:-9999px)
             to keep it off-screen during normal viewing. Inline styles beat
             any class selector regardless of @media context, so without
             !important this rule never actually overrides that inline
             left:-9999px at print time — the content silently prints
             9999px off the page, producing a blank Chrome print preview.
             Found via a real production report (打印预览显示正常，点击打印后
             Chrome 预览为空). */
          .print-slip { position: fixed !important; inset: 0 !important; width: 100% !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* Mobile drawer backdrop */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 md:hidden" onClick={() => setMobileNavOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 shrink-0 bg-gradient-to-b from-violet-700 via-violet-800 to-violet-950 text-violet-100 flex flex-col transition-transform duration-200 md:static md:z-auto md:w-56 md:translate-x-0 glass-panel shadow-[4px_0_24px_-8px_rgba(0,0,0,0.35)] ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-5 py-5 border-b border-violet-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-teal-300 to-teal-500 flex items-center justify-center icon-badge-3d">
              <Boxes size={18} className="text-violet-900" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white leading-tight">MY电商 ERP</div>
              <div className="text-[11px] text-violet-300 leading-tight">{t("AI 智能管理系统", "AI Management System")}</div>
            </div>
          </div>
          <button onClick={() => setMobileNavOpen(false)} className="text-violet-300 hover:text-white md:hidden">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 py-3 px-3 overflow-y-auto space-y-1">
          {NAV.filter((item) => myRole === "owner" || !OWNER_ONLY_TAB_KEYS.includes(item.key)).map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => { setTab(item.key); setMobileNavOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm rounded-xl nav-item-3d ${
                  active ? "is-active text-violet-700 font-medium" : "text-violet-300 hover:text-white hover:bg-white/10"
                }`}
              >
                <Icon size={16} />
                {lang === "en" ? item.en : item.zh}
              </button>
            );
          })}
        </nav>
        <div className="mx-3 mb-3 mt-1 rounded-xl bg-white/10 border border-white/10 px-3 py-2.5 glass-panel">
          <div className="text-xs font-medium text-white truncate">{session?.user?.email}</div>
          <div className="text-[10px] text-violet-300 mt-0.5">{t("MVP 演示版 · 模拟数据", "MVP Demo · Mock Data")}</div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 bg-gradient-to-br from-violet-50/40 via-white to-white min-h-screen">
        <header className="h-14 border-b border-slate-200 bg-white flex items-center px-3 md:px-6 justify-between gap-2 shadow-[0_1px_3px_rgba(15,23,42,0.06)] relative z-10">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={() => setMobileNavOpen(true)} className="text-slate-500 hover:text-slate-800 md:hidden shrink-0">
              <Menu size={20} />
            </button>
            <div className="text-sm text-slate-500 truncate">
              {(() => {
                const current = NAV.find((n) => n.key === tab);
                return current ? (lang === "en" ? current.en : current.zh) : "";
              })()}
            </div>
          </div>
          <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
            <div className="hidden md:block text-xs text-slate-400">{session.user.email}</div>
            <button
              onClick={() => loadRealData(false)}
              className="flex items-center gap-1.5 text-xs px-2 md:px-2.5 py-1 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50 btn-3d"
              title={t("重新读取数据", "Reload data")}
            >
              <RefreshCw size={13} />
              <span className="hidden sm:inline">{t("刷新", "Refresh")}</span>
            </button>
            <button
              onClick={() => setLang((prev) => (prev === "zh" ? "en" : "zh"))}
              className="text-xs px-2 md:px-2.5 py-1 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50 btn-3d"
              title={t("切换语言", "Switch language")}
            >
              {lang === "zh" ? "中 / EN" : "EN / 中"}
            </button>
            <button
              onClick={() => supabaseClient.auth.signOut()}
              className="flex items-center gap-1.5 text-xs px-2 md:px-2.5 py-1 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50 btn-3d"
              title={t("登出", "Log out")}
            >
              <LogOut size={13} />
              <span className="hidden sm:inline">{t("登出", "Log out")}</span>
            </button>
          </div>
        </header>

        <div className="p-3 md:p-6">
          {tab === "overview" && (
            <Overview
              t={t}
              orders={orders}
              inventory={inventory}
              stores={stores}
              onOpenOrder={setSelectedOrder}
              goTo={setTab}
              onGoToOrdersToShip={(platform) => { setOrdersEntryFilter({ platform, status: "__to_ship__" }); setTab("orders"); }}
            />
          )}
          {tab === "orders" && (
            <Orders t={t} orders={orders} stores={stores} onOpenOrder={setSelectedOrder} onPrint={openLockedPrint} onConfirmProcess={confirmProcess} onUpdateStatus={updateOrderStatus} onUpdateNote={updateOrderNote} onMarkPicked={markPicked} onMarkPacked={markPacked} goTo={setTab} entryFilter={ordersEntryFilter} onConsumeEntryFilter={() => setOrdersEntryFilter(null)} />
          )}
          {tab === "manualimport" && (
            <AutoImportHub
              t={t}
              lang={lang}
              stores={stores}
              inventory={inventory}
              orders={orders}
              adjustmentRequests={adjustmentRequests}
              myRole={myRole}
              onCreate={createAdjustmentRequest}
              onApprove={approveAdjustmentRequest}
              onReject={rejectAdjustmentRequest}
              cancellationRecords={cancellationRecords}
              onFinalizeCancellation={finalizeOrderCancellation}
              goTo={setTab}
              onRefresh={() => loadRealData(true)}
              onConnectStore={connectStore}
              onSetSyncMode={setStoreSyncMode}
              onUpdateStoreName={updateStoreName}
              onUpdateStoreAppearance={updateStoreAppearance}
            />
          )}
          {tab === "products" && <ProductMaster t={t} inventory={inventory} onCreate={createProduct} onUpdate={updateProductMaster} onDelete={deleteProduct} />}
          {tab === "suppliers" && myRole === "owner" && <SupplierMaster t={t} suppliers={suppliers} onCreate={createSupplier} onUpdate={updateSupplier} onDelete={deleteSupplier} />}
          {tab === "purchaseorders" && myRole === "owner" && (
            <PurchaseOrderList
              t={t}
              purchaseOrders={purchaseOrders}
              suppliers={suppliers}
              products={inventory}
              onCreate={createPurchaseOrder}
              onUpdate={updatePurchaseOrder}
              onUpdateStatus={updatePurchaseOrderStatus}
              onDelete={deletePurchaseOrder}
              onReceive={registerReceiving}
            />
          )}
          {tab === "inventory" && (
            <Inventory
              t={t}
              inventory={inventory}
              stores={stores}
              onUpdateLocation={updateProductLocation}
              onRecordMovement={recordStockMovement}
              warehouseLocations={warehouseLocations}
              onCreateLocation={createWarehouseLocation}
              onDeleteLocation={deleteWarehouseLocation}
              onBindLocation={bindProductLocation}
            />
          )}
          {tab === "productmove" && (
            <ProductMove
              t={t}
              inventory={inventory}
              logs={transferLogs}
              stores={stores}
              onTransfer={transferStock}
              onMoveShop={moveProductToShop}
            />
          )}
          {tab === "finance" && <Finance t={t} orders={orders} stores={stores} />}
          {tab === "ads" && <AdsSpend t={t} />}
          {tab === "ai" && <AIPanel t={t} orders={orders} inventory={inventory} />}
          {tab === "labels" && <LabelPrinting t={t} orders={orders} stores={stores} onPrint={openDesignPrint} onReprint={reprintFromHistory} onUpdateSellerInfo={updateStoreSellerInfo} />}
          {tab === "warehouse" && <Warehouse t={t} orders={orders} onPrint={openDesignPrint} onMarkPicked={markPicked} onMarkPacked={markPacked} />}
          {tab === "adjustments" && (
            <InventoryAdjustment
              t={t}
              lang={lang}
              inventory={inventory}
              adjustmentRequests={adjustmentRequests}
              myRole={myRole}
              onCreate={createAdjustmentRequest}
              onApprove={approveAdjustmentRequest}
              onReject={rejectAdjustmentRequest}
              cancellationRecords={cancellationRecords}
              onFinalizeCancellation={finalizeOrderCancellation}
            />
          )}
          {tab === "roles" && myRole === "owner" && <Roles t={t} />}
          {tab === "shiptest" && myRole === "owner" && <ShipPackageTest t={t} />}
        </div>
      </main>

      {selectedOrder && (
        <OrderDrawer t={t} order={selectedOrder} onClose={() => setSelectedOrder(null)} onPrint={(o) => openLockedPrint([o])} onUpdateStatus={updateOrderStatus} onRequestCancel={requestOrderCancellation} />
      )}
      {printOrders && printOrders.length > 0 && (
        <PrintSlip
          t={t}
          orders={printOrders}
          stores={stores}
          locked={printLocked}
          initialOverrides={printInitialOverrides}
          onClose={() => { setPrintOrders(null); setPrintInitialOverrides({}); }}
          onConfirmPrint={(templateDataByOrderId) => handlePrintConfirm(printOrders.map((o) => o.id), templateDataByOrderId)}
        />
      )}
    </div>
  );
}
