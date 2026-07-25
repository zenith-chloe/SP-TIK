import { useState } from "react";
import {
  Warehouse, Store, ArrowRightLeft, AlertTriangle, CheckCircle2, LogIn,
  Link2, Plus, Zap, FileSpreadsheet, Info, X, RefreshCw,
} from "lucide-react";
import { PLATFORM_THEME, warehouseLabel } from "./shared.jsx";

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

export function StoreManagement({ t, stores, onConnect, onSetSyncMode }) {
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState("Shopee");
  const [oauthPlatform, setOauthPlatform] = useState(null); // null | "Shopee" | "TikTok Shop"

  function handleConnect() {
    if (!name.trim()) return;
    onConnect(name.trim(), platform);
    setName("");
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-sm font-medium mb-3 flex items-center gap-1.5">
          <LogIn size={14} className="text-teal-500" /> {t("使用平台账号登录连接（预览效果）", "Connect via Platform Login (Preview)")}
        </div>
        <div className="text-xs text-slate-400 mb-3">
          {t(
            "以后拿到 Shopee / TikTok Shop 的官方 API 之后，正式版会是这个体验：点一下按钮，跳转去平台登录、授权，完成后自动开始实时同步。下面可以先点一下看看这个流程大概长什么样——",
            "Once official Shopee / TikTok Shop API access is granted, the real version will work like this: click the button, log in and authorize on the platform, then it auto-syncs in real time. You can preview roughly what that flow looks like below — ",
          )}
          <span className="text-amber-600 font-medium">{t("这是UI预览，不会真的连到你的账号", "this is a UI preview and won't actually connect to your account")}</span>
          {t("，因为还没有正式 API Key 和后端支持。", ", since production API keys and backend support aren't set up yet.")}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setOauthPlatform("Shopee")}
            className="flex-1 flex items-center justify-center gap-2 text-sm px-4 py-2.5 rounded-lg border border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100"
          >
            <LogIn size={15} /> {t("使用 Shopee 登录连接", "Connect with Shopee Login")}
          </button>
          <button
            onClick={() => setOauthPlatform("TikTok Shop")}
            className="flex-1 flex items-center justify-center gap-2 text-sm px-4 py-2.5 rounded-lg border border-slate-400 bg-slate-50 text-slate-700 hover:bg-slate-100"
          >
            <LogIn size={15} /> {t("使用 TikTok Shop 登录连接", "Connect with TikTok Shop Login")}
          </button>
        </div>
      </div>

      {oauthPlatform && (
        <OAuthConnectModal
          t={t}
          platform={oauthPlatform}
          onClose={() => setOauthPlatform(null)}
          onConnected={(shopNames) => {
            shopNames.forEach((n) => onConnect(n, oauthPlatform, "api"));
            setOauthPlatform(null);
          }}
        />
      )}

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
        return (
          <div key={pf} className={`rounded-xl border ${theme.border} overflow-hidden bg-white`}>
            <div className={`${theme.headerBg} text-white px-5 py-3 flex items-center justify-between`}>
              <span className="text-sm font-medium flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-white/80" /> {pf}
              </span>
              <span className="text-[11px] bg-white/20 px-2 py-0.5 rounded-full">{t(`${list.length} 个已连接店铺`, `${list.length} store(s) connected`)}</span>
            </div>
            {list.length === 0 && <div className="text-xs text-slate-400 text-center py-6">{t(`尚未连接任何 ${pf} 店铺`, `No ${pf} stores connected yet`)}</div>}
            {list.length > 0 && (
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                    <th className="py-2 pr-3 pl-5 font-medium">{t("店铺名称", "Store Name")}</th>
                    <th className="py-2 pr-3 font-medium">{t("连接时间", "Connected At")}</th>
                    <th className="py-2 pr-3 font-medium">{t("数据同步方式", "Sync Method")}</th>
                    <th className="py-2 pr-3 pr-5 font-medium">{t("状态", "Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2.5 pr-3 pl-5 font-medium">{s.name}</td>
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

function OAuthConnectModal({ t, platform, onClose, onConnected }) {
  const [step, setStep] = useState("login"); // login -> authorize -> connecting -> success
  const [account, setAccount] = useState("");
  const [selectedShops, setSelectedShops] = useState(() => new Set());
  const theme = PLATFORM_THEME[platform];
  const mockShops = platform === "Shopee"
    ? ["Shopee 官方旗舰店", "Shopee 分店 2"]
    : ["TikTok Shop 主账号"];

  function toggleShop(name) {
    setSelectedShops((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function handleLogin() {
    if (!account.trim()) return;
    setStep("authorize");
  }

  function handleAuthorize() {
    setStep("connecting");
    setTimeout(() => setStep("success"), 1200);
  }

  function handleFinish() {
    onConnected(Array.from(selectedShops));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-[380px] bg-white rounded-xl shadow-xl overflow-hidden">
        <div className={`${theme.headerBg} text-white px-5 py-3 flex items-center justify-between`}>
          <span className="text-sm font-medium">{t(`${platform} 授权登录（预览模拟）`, `${platform} Authorization Login (Preview)`)}</span>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X size={16} /></button>
        </div>

        <div className="p-5">
          <div className="mb-3 flex items-center gap-2 text-[11px] px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
            <Info size={12} className="shrink-0" /> {t(`这是模拟画面，不会真的连到你的 ${platform} 账号`, `This is a simulated screen and won't actually connect to your ${platform} account`)}
          </div>

          {step === "login" && (
            <>
              <div className="text-sm font-medium mb-3">{t(`登录你的 ${platform} 卖家账号`, `Log in to your ${platform} seller account`)}</div>
              <input
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder={t("手机号 / 邮箱（模拟输入）", "Phone / Email (simulated input)")}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-teal-400 mb-2"
              />
              <input
                type="password"
                placeholder={t("密码（模拟输入，不会被记录）", "Password (simulated input, not recorded)")}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-teal-400 mb-4"
              />
              <button
                onClick={handleLogin}
                disabled={!account.trim()}
                className={`w-full text-sm py-2 rounded-lg text-white ${account.trim() ? "bg-slate-900 hover:bg-slate-800" : "bg-slate-300 cursor-not-allowed"}`}
              >
                {t("登录", "Log in")}
              </button>
            </>
          )}

          {step === "authorize" && (
            <>
              <div className="text-sm font-medium mb-2">{t("我们的ERP系统请求以下权限", "Our ERP system is requesting the following permissions")}</div>
              <div className="text-xs text-slate-500 mb-3">{t("账号：", "Account: ")}{account}</div>
              <ul className="text-xs text-slate-600 space-y-1.5 mb-4">
                <li className="flex items-center gap-2"><CheckCircle2 size={13} className="text-teal-500" /> {t("读取 / 更新订单信息", "Read / update order info")}</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={13} className="text-teal-500" /> {t("读取 / 更新库存信息", "Read / update inventory info")}</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={13} className="text-teal-500" /> {t("读取物流 / 追踪信息", "Read shipping / tracking info")}</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={13} className="text-teal-500" /> {t("读取店铺基本信息", "Read basic store info")}</li>
              </ul>
              <div className="flex gap-2">
                <button onClick={onClose} className="flex-1 text-sm py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                  {t("取消", "Cancel")}
                </button>
                <button onClick={handleAuthorize} className="flex-1 text-sm py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800">
                  {t("同意并连接", "Agree & Connect")}
                </button>
              </div>
            </>
          )}

          {step === "connecting" && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <RefreshCw size={24} className="text-teal-500 animate-spin" />
              <div className="text-sm text-slate-500">{t("正在建立连接...", "Connecting...")}</div>
            </div>
          )}

          {step === "success" && (
            <>
              <div className="flex items-center gap-2 mb-3 text-emerald-600">
                <CheckCircle2 size={16} /> <span className="text-sm font-medium">{t("已连接，选择要加入系统的店铺", "Connected — select stores to add")}</span>
              </div>
              <div className="space-y-2 mb-4">
                {mockShops.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50">
                    <input type="checkbox" checked={selectedShops.has(s)} onChange={() => toggleShop(s)} className="h-3.5 w-3.5 rounded border-slate-300" />
                    {s}
                  </label>
                ))}
              </div>
              <button
                onClick={handleFinish}
                disabled={selectedShops.size === 0}
                className={`w-full text-sm py-2 rounded-lg text-white ${selectedShops.size > 0 ? "bg-slate-900 hover:bg-slate-800" : "bg-slate-300 cursor-not-allowed"}`}
              >
                {t(`完成连接（${selectedShops.size}）`, `Finish Connecting (${selectedShops.size})`)}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
