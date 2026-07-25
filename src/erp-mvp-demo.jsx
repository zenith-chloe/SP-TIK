import React, { useState, useEffect } from "react";
import { Boxes, RefreshCw, LogIn, LogOut, AlertTriangle, Menu, X } from "lucide-react";
import {
  supabaseClient, mapDbStore, mapDbProduct, mapDbOrder, mapDbTransferLog, DEMO_TO_DB_STATUS, DEMO_TO_DB_PLATFORM, NAV,
} from "./shared.jsx";
import { Overview, Orders, OrderDrawer, Inventory } from "./pagesOverviewOrders.jsx";
import { ProductMove, StoreManagement } from "./pagesMove.jsx";
import { ManualImport, Finance, AIPanel, Roles, AdsSpend, PrintSlip } from "./pagesImportFinance.jsx";

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

/* ============================== App ============================== */

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = checking, null = logged out
  const [dataLoading, setDataLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [transferLogs, setTransferLogs] = useState([]);
  const [stores, setStores] = useState([]);
  const [tab, setTab] = useState("overview");
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [printOrders, setPrintOrders] = useState(null);
  const [lang, setLang] = useState("zh"); // "zh" | "en"
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const t = (zh, en) => (lang === "en" ? en : zh);

  useEffect(() => {
    supabaseClient.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabaseClient.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function loadRealData(silent = false) {
    if (!silent) setDataLoading(true);
    const [accountsRes, productsRes, ordersRes, itemsRes, transferLogsRes] = await Promise.all([
      supabaseClient.from("platform_accounts").select("id, platform, account_name, created_at, token_expires_at"),
      supabaseClient.from("products").select("sku, name, warehouse_a_qty, warehouse_b_qty, listed_shop_id"),
      supabaseClient.from("orders").select("id, order_no, platform, buyer_name, buyer_phone, shipping_address, tracking_no, courier, order_status, platform_status, shipping_fee, order_date, print_count, note_color, note_text"),
      supabaseClient.from("order_items").select("order_id, sku, product_name, variation, qty, unit_price, image_url"),
      supabaseClient.from("transfer_logs").select("id, type, sku, from_location, to_location, qty, created_at").order("created_at", { ascending: false }),
    ]);
    const itemsByOrder = {};
    (itemsRes.data || []).forEach((it) => {
      (itemsByOrder[it.order_id] ||= []).push(it);
    });
    const mappedStores = (accountsRes.data || []).map(mapDbStore);
    const firstShopeeStore = mappedStores.find((s) => s.platform === "Shopee")?.id;
    setStores(mappedStores);
    setInventory((productsRes.data || []).map((p) => mapDbProduct(p, firstShopeeStore)));
    setOrders((ordersRes.data || []).map((o) => mapDbOrder(o, itemsByOrder[o.id] || [])));
    setTransferLogs((transferLogsRes.data || []).map(mapDbTransferLog));
    if (!silent) setDataLoading(false);
  }

  useEffect(() => {
    if (session) loadRealData();
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => loadRealData(true), 60000);
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

    supabaseClient.from("products").update({ warehouse_a_qty: nextA, warehouse_b_qty: nextB }).eq("sku", sku);
    supabaseClient.from("transfer_logs").insert({ type: "warehouse", sku, from_location: fromWarehouse, to_location: toWarehouse, qty });
  }

  function moveProductToShop(sku, fromShopId, toShopId) {
    setInventory((prev) => prev.map((item) => (item.sku === sku ? { ...item, listedShop: toShopId } : item)));
    const fromName = stores.find((s) => s.id === fromShopId)?.name || fromShopId;
    const toName = stores.find((s) => s.id === toShopId)?.name || toShopId;
    setTransferLogs((prev) => [
      { id: `SM-${Date.now()}`, type: "shop", sku, from: fromName, to: toName, qty: null, date: new Date().toISOString() },
      ...prev,
    ]);

    supabaseClient.from("products").update({ listed_shop_id: toShopId }).eq("sku", sku);
    supabaseClient.from("transfer_logs").insert({ type: "shop", sku, from_location: fromName, to_location: toName, qty: null });
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
      supabaseClient.from("orders").update({ order_status: dbStatus }).eq("order_no", orderId);
    }
  }

  function updateOrderNote(orderId, color, text) {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, noteColor: color, noteText: text } : o)));
    supabaseClient.from("orders").update({ note_color: color, note_text: text }).eq("order_no", orderId);
  }

  function incrementPrintCount(orderIds) {
    setOrders((prev) => prev.map((o) => (orderIds.includes(o.id) ? { ...o, printCount: (o.printCount || 0) + 1 } : o)));
    orderIds.forEach((orderId) => {
      const current = orders.find((o) => o.id === orderId)?.printCount || 0;
      supabaseClient.from("orders").update({ print_count: current + 1 }).eq("order_no", orderId);
    });
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
            <Orders t={t} orders={orders} stores={stores} onOpenOrder={setSelectedOrder} onPrint={setPrintOrders} onUpdateStatus={updateOrderStatus} onUpdateNote={updateOrderNote} goTo={setTab} />
          )}
          {tab === "manualimport" && <ManualImport t={t} stores={stores} inventory={inventory} onImport={importOrders} />}
          {tab === "inventory" && <Inventory t={t} inventory={inventory} stores={stores} />}
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
          {tab === "roles" && <Roles t={t} />}
        </div>
      </main>

      {selectedOrder && (
        <OrderDrawer t={t} order={selectedOrder} onClose={() => setSelectedOrder(null)} onPrint={(o) => setPrintOrders([o])} onUpdateStatus={updateOrderStatus} />
      )}
      {printOrders && printOrders.length > 0 && (
        <PrintSlip t={t} orders={printOrders} onClose={() => setPrintOrders(null)} onConfirmPrint={() => incrementPrintCount(printOrders.map((o) => o.id))} />
      )}
    </div>
  );
}
