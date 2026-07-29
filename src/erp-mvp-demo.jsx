import React, { useState, useEffect, useRef } from "react";
import { Boxes, RefreshCw, LogIn, LogOut, AlertTriangle, Menu, X } from "lucide-react";
import {
  supabaseClient, mapDbStore, mapDbProduct, mapDbOrder, mapDbTransferLog, DEMO_TO_DB_STATUS, DEMO_TO_DB_PLATFORM, NAV,
} from "./shared.jsx";
import { Overview, Orders, OrderDrawer, Inventory } from "./pagesOverviewOrders.jsx";
import { ProductMove, StoreManagement } from "./pagesMove.jsx";
import { ManualImport, Finance, AIPanel, Roles, AdsSpend, PrintSlip, LabelPrinting } from "./pagesImportFinance.jsx";
import { Warehouse } from "./pagesWarehouse.jsx";
import { ProductMaster } from "./pagesProducts.jsx";

/* ============================== Login ============================== */

function LoginScreen({ t }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error: authError } = await supabaseClient.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (authError) setError(authError.message);
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
          <label className="text-xs text-slate-500 mb-1 block">{t("邮箱", "Email")}</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-teal-400"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">{t("密码", "Password")}</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-teal-400"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border bg-rose-50 text-rose-600 border-rose-200">
            <AlertTriangle size={13} /> {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className={`w-full flex items-center justify-center gap-1.5 text-sm py-2 rounded-lg text-white ${busy ? "bg-slate-300 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800"}`}
        >
          <LogIn size={15} /> {busy ? t("登录中…", "Signing in…") : t("登录", "Log in")}
        </button>
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
  const [dataLoading, setDataLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [transferLogs, setTransferLogs] = useState([]);
  const [warehouseLocations, setWarehouseLocations] = useState([]);
  const [stores, setStores] = useState([]);
  const [tab, setTab] = useState("overview");
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

  const ORDER_COLUMNS = "id, order_no, platform, platform_account_id, buyer_name, buyer_phone, shipping_address, tracking_no, courier, order_status, platform_status, warehouse_stage, is_cod, shipping_fee, order_date, print_count, last_printed_at, last_printed_by, note_color, note_text, updated_at";

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
          .select("order_id, sku, product_name, variation, qty, unit_price, image_url")
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

    let ordersQuery = supabaseClient.from("orders").select(ORDER_COLUMNS);
    ordersQuery = isIncremental
      ? ordersQuery.gt("updated_at", lastSyncAtRef.current)
      : ordersQuery.order("order_date", { ascending: false }).limit(5000);

    const [accountsRes, productsRes, ordersRes, transferLogsRes, warehouseLocationsRes] = await Promise.all([
      supabaseClient.from("platform_accounts").select("id, platform, account_name, created_at, token_expires_at, seller_name, seller_address, seller_phone"),
      supabaseClient.from("products").select("sku, name, warehouse_a_qty, warehouse_b_qty, listed_shop_id, location, location_id, price, weight_kg, unit, image_url"),
      ordersQuery,
      supabaseClient.from("transfer_logs").select("id, type, sku, from_location, to_location, qty, created_at").order("created_at", { ascending: false }),
      supabaseClient.from("warehouse_locations").select("id, parent_id, level, code, name"),
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
    setTransferLogs((transferLogsRes.data || []).map(mapDbTransferLog));
    setWarehouseLocations(warehouseLocationsRes.data || []);

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

  useEffect(() => {
    if (session) loadRealData();
  }, [session]);

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
  async function createProduct({ sku, name, price, weightKg, unit, imageUrl, initialStock }) {
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
    });
    if (error) return { error: error.message };
    setInventory((prev) => [
      ...prev,
      {
        sku, name, warehouseA: initialStock || 0, warehouseB: 0, reorderPoint: 20,
        shopeeLinked: true, tiktokLinked: true, listedShop: null, location: "",
        price: price || 0, weightKg: weightKg || 0, unit: unit || "", imageUrl: imageUrl || null,
      },
    ]);
    return { error: null };
  }

  async function updateProductMaster(sku, fields) {
    const { error } = await supabaseClient
      .from("products")
      .update({ name: fields.name, price: fields.price, weight_kg: fields.weightKg, unit: fields.unit || "pcs", image_url: fields.imageUrl || null })
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

  function connectStore(name, platform, syncMode = "manual") {
    setStores((prev) => [
      ...prev,
      { id: `store-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, platform, name, connectedAt: new Date().toISOString().slice(0, 10), status: "已连接", syncMode },
    ]);
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
  async function markPicked(orderNos) {
    const { data: dbOrders, error } = await supabaseClient
      .from("orders")
      .select("id, order_no")
      .in("order_no", orderNos)
      .eq("warehouse_stage", "printed");
    if (error || !dbOrders || dbOrders.length === 0) return;

    const ids = dbOrders.map((o) => o.id);
    const staffEmail = session?.user?.email || null;
    const { error: updateErr } = await supabaseClient.from("orders").update({ warehouse_stage: "picked" }).in("id", ids);
    if (updateErr) { console.error("markPicked failed", updateErr); return; }

    await supabaseClient
      .from("warehouse_action_log")
      .insert(ids.map((id) => ({ order_id: id, action: "picked", from_stage: "printed", to_stage: "picked", staff_email: staffEmail })))
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

    await supabaseClient
      .from("warehouse_action_log")
      .insert(ids.map((id) => ({ order_id: id, action: "packed", from_stage: "picked", to_stage: "ready_ship", staff_email: staffEmail })))
      .then(({ error: logErr }) => logErr && console.error("warehouse_action_log insert (packed) failed", logErr));

    const orderNoSet = new Set(dbOrders.map((o) => o.order_no));
    setOrders((prev) => prev.map((o) => (orderNoSet.has(o.id) ? { ...o, warehouseStage: "ready_ship" } : o)));

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
          .print-slip { position: fixed; inset: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* Mobile drawer backdrop */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 md:hidden" onClick={() => setMobileNavOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 shrink-0 bg-violet-900 text-violet-100 flex flex-col transition-transform duration-200 md:static md:z-auto md:w-56 md:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-5 py-5 border-b border-violet-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-teal-500 flex items-center justify-center">
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
        <nav className="flex-1 py-3 overflow-y-auto">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => { setTab(item.key); setMobileNavOpen(false); }}
                className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${
                  active ? "bg-violet-800 text-white border-r-2 border-teal-400" : "text-violet-300 hover:text-white hover:bg-violet-800/60"
                }`}
              >
                <Icon size={16} />
                {lang === "en" ? item.en : item.zh}
              </button>
            );
          })}
        </nav>
        <div className="px-5 py-4 border-t border-violet-800 text-[11px] text-violet-400">
          {t("MVP 演示版 · 模拟数据", "MVP Demo · Mock Data")}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0">
        <header className="h-14 border-b border-slate-200 bg-white flex items-center px-3 md:px-6 justify-between gap-2">
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
              onClick={loadRealData}
              className="flex items-center gap-1.5 text-xs px-2 md:px-2.5 py-1 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50"
              title={t("重新读取数据", "Reload data")}
            >
              <RefreshCw size={13} />
              <span className="hidden sm:inline">{t("刷新", "Refresh")}</span>
            </button>
            <button
              onClick={() => setLang((prev) => (prev === "zh" ? "en" : "zh"))}
              className="text-xs px-2 md:px-2.5 py-1 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50"
              title={t("切换语言", "Switch language")}
            >
              {lang === "zh" ? "中 / EN" : "EN / 中"}
            </button>
            <button
              onClick={() => supabaseClient.auth.signOut()}
              className="flex items-center gap-1.5 text-xs px-2 md:px-2.5 py-1 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50"
              title={t("登出", "Log out")}
            >
              <LogOut size={13} />
              <span className="hidden sm:inline">{t("登出", "Log out")}</span>
            </button>
          </div>
        </header>

        <div className="p-3 md:p-6">
          {tab === "overview" && <Overview t={t} orders={orders} inventory={inventory} stores={stores} onOpenOrder={setSelectedOrder} goTo={setTab} />}
          {tab === "orders" && (
            <Orders t={t} orders={orders} stores={stores} onOpenOrder={setSelectedOrder} onPrint={openLockedPrint} onConfirmProcess={confirmProcess} onUpdateStatus={updateOrderStatus} onUpdateNote={updateOrderNote} goTo={setTab} />
          )}
          {tab === "manualimport" && <ManualImport t={t} stores={stores} inventory={inventory} onImport={importOrders} />}
          {tab === "products" && <ProductMaster t={t} inventory={inventory} onCreate={createProduct} onUpdate={updateProductMaster} onDelete={deleteProduct} />}
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
          {tab === "stores" && <StoreManagement t={t} stores={stores} onConnect={connectStore} onSetSyncMode={setStoreSyncMode} />}
          {tab === "finance" && <Finance t={t} orders={orders} />}
          {tab === "ads" && <AdsSpend t={t} />}
          {tab === "ai" && <AIPanel t={t} orders={orders} inventory={inventory} />}
          {tab === "labels" && <LabelPrinting t={t} orders={orders} stores={stores} onPrint={openDesignPrint} onReprint={reprintFromHistory} onUpdateSellerInfo={updateStoreSellerInfo} />}
          {tab === "warehouse" && <Warehouse t={t} orders={orders} onPrint={openDesignPrint} onMarkPicked={markPicked} onMarkPacked={markPacked} />}
          {tab === "roles" && <Roles t={t} />}
        </div>
      </main>

      {selectedOrder && (
        <OrderDrawer t={t} order={selectedOrder} onClose={() => setSelectedOrder(null)} onPrint={(o) => openLockedPrint([o])} onUpdateStatus={updateOrderStatus} />
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
