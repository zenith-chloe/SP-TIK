import { useState, useEffect, useRef } from "react";
import {
  Warehouse, Store, ArrowRightLeft, AlertTriangle, CheckCircle2, LogIn,
  Link2, Plus, Zap, FileSpreadsheet, ShoppingBag, Music2,
} from "lucide-react";
import { PLATFORM_THEME, warehouseLabel, SUPABASE_URL } from "./shared.jsx";

const WAREHOUSES = ["吉隆坡仓", "柔佛仓"];

export function ProductMove({ t, inventory, logs, stores, onTransfer, onMoveShop }) {
  const [mode, setMode] = useState("warehouse"); // "warehouse" | "shop"

  return (
    <div className="space-y-4">
      <div className="inline-flex bg-white border border-slate-200 rounded-xl p-1 gap-1">
        <button
          onClick={() => setMode("warehouse")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === "warehouse" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          <Warehouse size={14} /> {t("仓库搬仓", "Warehouse Transfer")}
        </button>
        <button
          onClick={() => setMode("shop")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === "shop" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"
          }`}
        >
          <Store size={14} /> {t("店铺搬家（旧店铺 → 新店铺）", "Shop Move (Old Shop → New Shop)")}
        </button>
      </div>

      {mode === "warehouse" && <WarehouseMoveForm t={t} inventory={inventory} onTransfer={onTransfer} />}
      {mode === "shop" && <ShopMoveForm t={t} inventory={inventory} stores={stores} onMoveShop={onMoveShop} />}

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-sm font-medium mb-3">{t("搬仓 / 搬店记录", "Transfer / Move Log")}</div>
        {logs.length === 0 && <div className="text-xs text-slate-400 text-center py-6">{t("暂无记录", "No records yet")}</div>}
        {logs.length > 0 && (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                <th className="py-2 pr-3 font-medium">{t("类型", "Type")}</th>
                <th className="py-2 pr-3 font-medium">SKU</th>
                <th className="py-2 pr-3 font-medium">{t("从", "From")}</th>
                <th className="py-2 pr-3 font-medium">{t("到", "To")}</th>
                <th className="py-2 pr-3 font-medium text-right">{t("数量", "Qty")}</th>
                <th className="py-2 pr-3 font-medium">{t("时间", "Time")}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                      l.type === "shop" ? "bg-indigo-100 text-indigo-700 border-indigo-200" : "bg-slate-100 text-slate-600 border-slate-200"
                    }`}>
                      {l.type === "shop" ? t("店铺搬家", "Shop Move") : t("仓库搬仓", "Warehouse Transfer")}
                    </span>
                  </td>
                  <td className="py-2 pr-3 font-medium">{l.sku}</td>
                  <td className="py-2 pr-3">{l.from}</td>
                  <td className="py-2 pr-3">{l.to}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{l.qty ?? "—"}</td>
                  <td className="py-2 pr-3 text-slate-400 tabular-nums">{new Date(l.date).toLocaleString("en-MY").slice(0, 17)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}

function WarehouseMoveForm({ t, inventory, onTransfer }) {
  const [sku, setSku] = useState(inventory[0]?.sku || "");
  const [from, setFrom] = useState("吉隆坡仓");
  const [to, setTo] = useState("柔佛仓");
  const [qty, setQty] = useState(1);
  const [message, setMessage] = useState(null);
  const lang = t("zh", "en");

  const item = inventory.find((i) => i.sku === sku);
  const fromStock = item ? (from === "吉隆坡仓" ? item.warehouseA : item.warehouseB) : 0;

  function handleTransfer() {
    if (!item) return;
    if (from === to) {
      setMessage({ type: "error", text: t("出发仓库与目标仓库不能相同", "Source and destination warehouse cannot be the same") });
      return;
    }
    const n = Number(qty);
    if (!n || n <= 0) {
      setMessage({ type: "error", text: t("请输入有效的搬仓数量", "Please enter a valid quantity") });
      return;
    }
    if (n > fromStock) {
      setMessage({ type: "error", text: t(`${from} 库存不足，目前只有 ${fromStock} 件`, `Not enough stock in ${warehouseLabel(from, lang)} — only ${fromStock} left`) });
      return;
    }
    onTransfer(sku, from, to, n);
    setMessage({ type: "success", text: t(`已将 ${n} 件 ${item.name} 从 ${from} 搬到 ${to}`, `Moved ${n} × ${item.name} from ${warehouseLabel(from, lang)} to ${warehouseLabel(to, lang)}`) });
    setQty(1);
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-sm font-medium mb-3 flex items-center gap-1.5">
          <ArrowRightLeft size={14} className="text-teal-500" /> {t("仓库间调拨（同一商品，换个仓库存放）", "Transfer between warehouses (same product, different location)")}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">{t("选择商品 SKU", "Select Product SKU")}</label>
            <select
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-teal-400"
            >
              {inventory.map((i) => (
                <option key={i.sku} value={i.sku}>{i.sku} · {i.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">{t("搬仓数量", "Quantity")}</label>
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-teal-400"
            />
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">{t("从（出发仓库）", "From (Source)")}</label>
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-teal-400"
            >
              {WAREHOUSES.map((w) => (<option key={w} value={w}>{warehouseLabel(w, lang)}</option>))}
            </select>
            {item && <div className="text-[11px] text-slate-400 mt-1">{t(`当前库存：${fromStock} 件`, `Current stock: ${fromStock}`)}</div>}
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">{t("到（目标仓库）", "To (Destination)")}</label>
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-teal-400"
            >
              {WAREHOUSES.map((w) => (<option key={w} value={w}>{warehouseLabel(w, lang)}</option>))}
            </select>
          </div>
        </div>

        {message && (
          <div className={`mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${
            message.type === "error" ? "bg-rose-50 text-rose-600 border-rose-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"
          }`}>
            {message.type === "error" ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
            {message.text}
          </div>
        )}

        <button
          onClick={handleTransfer}
          className="mt-3 flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
        >
          <ArrowRightLeft size={14} /> {t("确认搬仓", "Confirm Transfer")}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-sm font-medium mb-3">{t("当前各仓库库存一览", "Current Stock by Warehouse")}</div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[500px]">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
              <th className="py-2 pr-3 font-medium">SKU</th>
              <th className="py-2 pr-3 font-medium">{t("商品名称", "Product Name")}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("吉隆坡仓", "KL Warehouse")}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("柔佛仓", "Johor Warehouse")}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("总库存", "Total Stock")}</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map((i) => (
              <tr key={i.sku} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-3 font-medium">{i.sku}</td>
                <td className="py-2 pr-3">{i.name}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{i.warehouseA}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{i.warehouseB}</td>
                <td className="py-2 pr-3 text-right tabular-nums font-medium">{i.warehouseA + i.warehouseB}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

function ShopMoveForm({ t, inventory, stores, onMoveShop }) {
  const [sku, setSku] = useState(inventory[0]?.sku || "");
  const [toShop, setToShop] = useState("");
  const [message, setMessage] = useState(null);

  const item = inventory.find((i) => i.sku === sku);
  const fromShop = stores.find((s) => s.id === item?.listedShop);
  const targetOptions = stores.filter((s) => s.id !== item?.listedShop);

  function handleMove() {
    if (!item) return;
    if (!toShop) {
      setMessage({ type: "error", text: t("请选择要搬去的新店铺", "Please select a destination store") });
      return;
    }
    const toStore = stores.find((s) => s.id === toShop);
    onMoveShop(sku, item.listedShop, toShop);
    setMessage({ type: "success", text: t(`已把「${item.name}」从「${fromShop?.name}」搬到「${toStore?.name}」`, `Moved "${item.name}" from "${fromShop?.name}" to "${toStore?.name}"`) });
    setToShop("");
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-sm font-medium mb-3 flex items-center gap-1.5">
        <Store size={14} className="text-indigo-500" /> {t("把商品从旧店铺搬去新店铺", "Move a product from an old store to a new store")}
      </div>
      <div className="text-xs text-slate-400 mb-4">
        {t(
          "适用场景：旧店铺要收掉 / 换新店铺经营，把商品的库存归属、上架资料转移到新店铺，不影响仓库实际库存数量。",
          "Use case: closing an old store / moving to a new one — transfers listing ownership to the new store without affecting actual warehouse stock.",
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-slate-500 mb-1 block">{t("选择商品 SKU", "Select Product SKU")}</label>
          <select
            value={sku}
            onChange={(e) => { setSku(e.target.value); setToShop(""); }}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-indigo-400"
          >
            {inventory.map((i) => (
              <option key={i.sku} value={i.sku}>{i.sku} · {i.name}</option>
            ))}
          </select>
          {fromShop && (
            <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
              {t("目前所属：", "Currently under:")}
              <span className="inline-flex items-center gap-1 font-medium text-slate-600">
                <span className={`h-1.5 w-1.5 rounded-full ${PLATFORM_THEME[fromShop.platform].dot}`} />
                {fromShop.name}
              </span>
            </div>
          )}
        </div>
        <div>
          <label className="text-xs text-slate-500 mb-1 block">{t("搬去新店铺", "Move to New Store")}</label>
          <select
            value={toShop}
            onChange={(e) => setToShop(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-indigo-400"
          >
            <option value="">{t("请选择目标店铺", "Select a destination store")}</option>
            {targetOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.name}（{s.platform}）</option>
            ))}
          </select>
        </div>
      </div>

      {message && (
        <div className={`mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${
          message.type === "error" ? "bg-rose-50 text-rose-600 border-rose-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"
        }`}>
          {message.type === "error" ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
          {message.text}
        </div>
      )}

      <button
        onClick={handleMove}
        className="mt-3 flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
      >
        <Store size={14} /> {t("确认搬店", "Confirm Move")}
      </button>
    </div>
  );
}

/* ============================== Store management (店铺管理) ============================== */

// Shared by StoreManagement (店铺管理) and AutoImportHub's "使用平台账号登录连接"
// card — one component, two entry points, per explicit instruction to reuse
// rather than duplicate.
export function PlatformLoginConnect({ t, stores, onRefresh }) {
  const storeCountRef = useRef(stores.length);
  const pollRef = useRef(null);
  const focusHandlerRef = useRef(null);
  useEffect(() => { storeCountRef.current = stores.length; }, [stores]);
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (focusHandlerRef.current) window.removeEventListener("focus", focusHandlerRef.current);
  }, []);

  // -auth-callback runs server-side in the OAuth tab, so it can't directly
  // signal this tab. The browser refocusing this tab (user closed/switched
  // back from the OAuth tab) is the trigger instead: fire loadRealData once
  // immediately, then a short backup poll (5s x up to 3) in case the first
  // read landed before the callback finished writing — stops as soon as the
  // store count actually grows.
  function armRefreshOnReturn() {
    if (focusHandlerRef.current) window.removeEventListener("focus", focusHandlerRef.current);
    if (pollRef.current) clearInterval(pollRef.current);

    function onFocus() {
      window.removeEventListener("focus", onFocus);
      focusHandlerRef.current = null;
      const before = storeCountRef.current;
      onRefresh?.();
      let attempts = 0;
      pollRef.current = setInterval(() => {
        if (storeCountRef.current > before) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          return;
        }
        attempts += 1;
        onRefresh?.();
        if (attempts >= 3) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 5000);
    }
    focusHandlerRef.current = onFocus;
    window.addEventListener("focus", onFocus);
  }

  // Sends the browser to the real OAuth authorize flow (tiktok-auth-start /
  // shopee-auth-start), same as clicking a "Connect with X" button anywhere
  // else. Opened in a new tab so this page stays open.
  function startOAuth(fnName) {
    window.open(`${SUPABASE_URL}/functions/v1/${fnName}`, "_blank");
    armRefreshOnReturn();
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-sm font-medium mb-3 flex items-center gap-1.5">
        <LogIn size={14} className="text-teal-500" /> {t("使用平台账号登录连接", "Connect via Platform Login")}
      </div>
      <div className="text-xs text-slate-400 mb-3">
        {t(
          "点击后会在新标签页跳转到平台的登录/授权页面，完成授权后关闭该标签页，回到这里即可看到新连接的店铺（最多等待约20秒自动刷新）。",
          "Clicking opens a new tab for the platform's login/authorize page. After authorizing, close that tab and come back here — the new store shows up automatically (auto-refreshes within ~20s).",
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => startOAuth("shopee-auth-start")}
          className="flex-1 flex items-center justify-center gap-2 text-sm px-4 py-2.5 rounded-lg border border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100"
        >
          <LogIn size={15} /> {t("使用 Shopee 登录连接", "Connect with Shopee Login")}
        </button>
        <button
          onClick={() => startOAuth("tiktok-auth-start")}
          className="flex-1 flex items-center justify-center gap-2 text-sm px-4 py-2.5 rounded-lg border border-slate-400 bg-slate-50 text-slate-700 hover:bg-slate-100"
        >
          <LogIn size={15} /> {t("使用 TikTok Shop 登录连接", "Connect with TikTok Shop Login")}
        </button>
      </div>
    </div>
  );
}

export function StoreManagement({ t, stores, onConnect, onSetSyncMode, onRefresh }) {
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState("Shopee");

  function handleConnect() {
    if (!name.trim()) return;
    onConnect(name.trim(), platform);
    setName("");
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-sm font-medium mb-3 flex items-center gap-1.5">
          <Link2 size={14} className="text-teal-500" /> {t("手动连接新店铺（现阶段实际使用的方式）", "Manually Connect a New Store (current real workflow)")}
        </div>
        <div className="text-xs text-slate-400 mb-3">
          {t(
            "支持连接多个商家 / 多个店铺账号（同一平台可连多个店铺），连接后即可在订单、库存等模块中管理该店铺的数据。",
            "Supports connecting multiple merchants / store accounts (multiple stores per platform). Once connected, you can manage that store's data in Orders, Inventory, etc.",
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-teal-400"
          >
            <option>Shopee</option>
            <option>TikTok Shop</option>
          </select>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("输入店铺名称，例如：Shopee 分店2", "Enter store name, e.g. Shopee Branch 2")}
            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-teal-400"
          />
          <button
            onClick={handleConnect}
            className="flex items-center justify-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
          >
            <Plus size={14} /> {t("连接", "Connect")}
          </button>
        </div>
        <div className="mt-3 text-[11px] text-slate-400">
          {t(
            "新连接的店铺默认是\"手动导入模式\"，等申请到平台 API 之后，可以在下面把该店铺切换成\"API自动同步\"，或者用上面的登录连接。",
            "Newly connected stores default to \"manual import mode\". Once you get platform API access, switch it to \"API auto-sync\" below, or use the login connect above.",
          )}
        </div>
      </div>

      {["Shopee", "TikTok Shop"].map((pf) => {
        const theme = PLATFORM_THEME[pf];
        const list = stores.filter((s) => s.platform === pf);
        const PfLogo = pf === "Shopee" ? ShoppingBag : Music2;
        return (
          <div key={pf} className={`rounded-xl border ${theme.border} overflow-hidden bg-white`}>
            <div className={`${theme.headerBg} text-white px-5 py-3 flex items-center justify-between`}>
              <span className="text-sm font-medium flex items-center gap-2">
                <PfLogo size={14} className="text-white" /> {pf}
              </span>
              <span className="text-[11px] bg-white/20 px-2 py-0.5 rounded-full">{t(`${list.length} 个已连接店铺`, `${list.length} store(s) connected`)}</span>
            </div>
            {list.length === 0 && <div className="text-xs text-slate-400 text-center py-6">{t(`尚未连接任何 ${pf} 店铺`, `No ${pf} stores connected yet`)}</div>}
            {list.length > 0 && (
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                    <th className="py-2 pr-3 pl-5 font-medium">{t("店铺名称", "Store Name")}</th>
                    <th className="py-2 pr-3 font-medium">Shop ID</th>
                    <th className="py-2 pr-3 font-medium">{t("连接时间", "Connected At")}</th>
                    <th className="py-2 pr-3 font-medium">{t("数据同步方式", "Sync Method")}</th>
                    <th className="py-2 pr-3 pr-5 font-medium">{t("状态", "Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2.5 pr-3 pl-5 font-medium flex items-center gap-1.5">
                        <PfLogo size={13} className={pf === "Shopee" ? "text-orange-500" : "text-slate-700"} /> {s.name}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-400">{s.shopId || "—"}</td>
                      <td className="py-2.5 pr-3 text-slate-500 tabular-nums">{s.connectedAt}</td>
                      <td className="py-2.5 pr-3">
                        {s.syncMode === "api" ? (
                          <span className="text-xs px-2 py-0.5 rounded-full border bg-emerald-100 text-emerald-700 border-emerald-200 inline-flex items-center gap-1">
                            <Zap size={11} /> {t("API自动同步", "API Auto-Sync")}
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full border bg-amber-100 text-amber-700 border-amber-200 inline-flex items-center gap-1">
                            <FileSpreadsheet size={11} /> {t("手动导入模式", "Manual Import Mode")}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 pr-5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-2 py-0.5 rounded-full border bg-emerald-100 text-emerald-700 border-emerald-200 inline-flex items-center gap-1">
                            <CheckCircle2 size={11} /> {t(s.status, "Connected")}
                          </span>
                          {s.syncMode === "manual" ? (
                            <button
                              onClick={() => onSetSyncMode(s.id, "api")}
                              className="text-[11px] px-2 py-1 rounded-full border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100"
                              title={t("已经申请到平台API了？点这里切换", "Already got platform API access? Click to switch")}
                            >
                              {t("标记为已获得API", "Mark as API Connected")}
                            </button>
                          ) : (
                            <button
                              onClick={() => onSetSyncMode(s.id, "manual")}
                              className="text-[11px] px-2 py-1 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100"
                            >
                              {t("改回手动导入", "Switch Back to Manual")}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

