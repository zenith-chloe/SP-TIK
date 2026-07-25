import { useState, useMemo } from "react";
import {
  Search, X, ChevronRight, AlertTriangle, CheckCircle2, Truck, Circle,
  CheckCircle, Printer, Clock, Info,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import {
  PLATFORM_THEME, SALES_TREND, STATUS_STEPS, EXTRA_STATUS, ACTIONABLE_STATUS,
  profit, fmt, statusColor, statusLabel, warehouseLabel,
} from "./shared.jsx";

/* ============================== Overview ============================== */

export function KPICard({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-start justify-between">
      <div>
        <div className="text-xs text-slate-500 mb-1">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
      </div>
      <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${tone}`}>
        <Icon size={16} className="text-white" />
      </div>
    </div>
  );
}

export function Overview({ t, orders, inventory, stores, onOpenOrder, goTo }) {
  const pending = orders.filter((o) => o.status === "待处理").length;
  const totalProfit = orders.filter((o) => o.status !== "已取消").reduce((s, o) => s + profit(o), 0);
  const lowStock = inventory.filter((i) => i.warehouseA + i.warehouseB < i.reorderPoint);
  const recent = orders.slice(0, 6);
  const manualStores = stores.filter((s) => s.syncMode === "manual");
  const lang = t("zh", "en");

  return (
    <div className="space-y-6">
      {manualStores.length > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <Info size={16} className="text-amber-600 shrink-0" />
          <div className="text-xs text-amber-800 flex-1">
            <span className="font-medium">
              {t(`${manualStores.length} 个店铺尚未连接平台API`, `${manualStores.length} store(s) not yet connected to platform API`)}
            </span>
            {t(
              `（${manualStores.map((s) => s.name).join("、")}），订单/库存需要手动导入更新，暂时无法自动同步。`,
              ` (${manualStores.map((s) => s.name).join(", ")}). Orders/inventory need manual import for now — auto-sync unavailable.`,
            )}
          </div>
          <button onClick={() => goTo("manualimport")} className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 shrink-0">
            {t("去手动导入", "Go to Manual Import")}
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label={t("订单总数", "Total Orders")} value={orders.length} sub="Shopee + TikTok Shop" icon={CheckCircle2} tone="bg-teal-500" />
        <KPICard label={t("待处理订单", "Pending Orders")} value={pending} sub={t("需要拣货/发货", "Needs picking/shipping")} icon={AlertTriangle} tone="bg-amber-500" />
        <KPICard label={t("库存预警 SKU", "Low Stock SKUs")} value={lowStock.length} sub={t("低于安全库存", "Below safety stock")} icon={AlertTriangle} tone="bg-rose-500" />
        <KPICard label={t("净利润 (RM)", "Net Profit (RM)")} value={fmt(totalProfit)} sub={t("已扣除平台费/佣金", "After platform fees/commission")} icon={CheckCircle2} tone="bg-indigo-500" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-sm font-medium mb-3">{t("近14天销售趋势（按平台）", "Last 14 Days Sales Trend (by Platform)")}</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={SALES_TREND}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="Shopee" stroke="#f97316" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="TikTok Shop" stroke="#e11d48" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-sm font-medium mb-3">{t("库存预警", "Stock Alerts")}</div>
          <div className="space-y-2">
            {lowStock.slice(0, 5).map((item) => (
              <div key={item.sku} className="flex items-center justify-between text-sm border-b border-slate-100 pb-2 last:border-0">
                <div>
                  <div className="font-medium">{item.name}</div>
                  <div className="text-xs text-slate-400">{item.sku}</div>
                </div>
                <span className="text-xs font-semibold text-rose-600 tabular-nums">{t(`${item.warehouseA + item.warehouseB} 件`, `${item.warehouseA + item.warehouseB} pcs`)}</span>
              </div>
            ))}
          </div>
          <button onClick={() => goTo("inventory")} className="mt-3 text-xs text-teal-600 flex items-center gap-1 hover:underline">
            {t("查看全部库存", "View all inventory")} <ChevronRight size={12} />
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium">{t("最新订单（两平台混合）", "Latest Orders (Both Platforms)")}</div>
          <button onClick={() => goTo("orders")} className="text-xs text-teal-600 flex items-center gap-1 hover:underline">
            {t("前往订单管理中心", "Go to Order Management")} <ChevronRight size={12} />
          </button>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
              <th className="py-2 pr-3 font-medium">{t("订单编号", "Order No.")}</th>
              <th className="py-2 pr-3 font-medium">{t("平台", "Platform")}</th>
              <th className="py-2 pr-3 font-medium">{t("客户", "Customer")}</th>
              <th className="py-2 pr-3 font-medium">{t("状态", "Status")}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("操作", "Action")}</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((o) => (
              <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="py-2.5 pr-3 font-medium">{o.id}</td>
                <td className="py-2.5 pr-3">
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span className={`h-2 w-2 rounded-full ${PLATFORM_THEME[o.platform].dot}`} />
                    {o.platform}
                  </span>
                </td>
                <td className="py-2.5 pr-3">{o.customer}</td>
                <td className="py-2.5 pr-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColor(o.status)}`}>{statusLabel(o.status, lang)}</span>
                </td>
                <td className="py-2.5 pr-3 text-right">
                  <button onClick={() => onOpenOrder(o)} className="text-xs text-teal-600 hover:underline">{t("查看详情", "View")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

/* ============================== Orders (订单管理中心) ============================== */

const NOTE_COLORS = { red: "#ef4444", yellow: "#eab308", purple: "#a855f7" };

export function Orders({ t, orders, stores, onOpenOrder, onPrint, onUpdateStatus, onUpdateNote, goTo }) {
  const [activePlatform, setActivePlatform] = useState("Shopee");
  const [statusFilter, setStatusFilter] = useState("全部");
  const [q, setQ] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [noteEditingId, setNoteEditingId] = useState(null);
  const [noteDraftText, setNoteDraftText] = useState("");
  const [noteDraftColor, setNoteDraftColor] = useState(null);
  const theme = PLATFORM_THEME[activePlatform];
  const lang = t("zh", "en");
  const chipLabel = (s) => (s === "全部" ? t("全部", "All") : statusLabel(s, lang));

  // 还没交给物流 = 官方平台的 "To Ship"：待处理（未付款）+ 拣货（已付款待发货）
  const NOT_YET_SHIPPED = ["待处理", "拣货"];
  const platformStores = stores.filter((s) => s.platform === activePlatform);
  const allManual = platformStores.length > 0 && platformStores.every((s) => s.syncMode === "manual");

  const all = useMemo(() => orders.filter((o) => o.platform === activePlatform), [orders, activePlatform]);
  const revenue = all.filter((o) => o.status !== "已取消").reduce((s, o) => s + o.unitPrice * o.qty, 0);
  const netProfit = all.filter((o) => o.status !== "已取消").reduce((s, o) => s + profit(o), 0);
  const pending = all.filter((o) => NOT_YET_SHIPPED.includes(o.status)).length;
  const processed = all.filter((o) => (o.printCount || 0) > 0).length;
  const delivered = all.filter((o) => o.status === "已签收").length;

  const filtered = useMemo(() => {
    return all.filter((o) => {
      if (statusFilter === "__not_shipped__") {
        if (!NOT_YET_SHIPPED.includes(o.status)) return false;
      } else if (statusFilter === "__printed__") {
        if (!((o.printCount || 0) > 0)) return false;
      } else if (statusFilter !== "全部" && o.status !== statusFilter) {
        return false;
      }
      if (dateFilter && o.date !== dateFilter) return false;
      if (q && !(o.id.toLowerCase().includes(q.toLowerCase()) || o.customer.includes(q) || (o.sku || "").toLowerCase().includes(q.toLowerCase()))) return false;
      return true;
    });
  }, [all, statusFilter, dateFilter, q]);

  const statusChips = ["全部", ...STATUS_STEPS, ...EXTRA_STATUS];
  const allChecked = filtered.length > 0 && filtered.every((o) => selectedIds.has(o.id));
  const selectedOrders = filtered.filter((o) => selectedIds.has(o.id));

  function toggleOne(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelectedIds((prev) => {
      if (allChecked) {
        const next = new Set(prev);
        filtered.forEach((o) => next.delete(o.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((o) => next.add(o.id));
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {allManual && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
          <Info size={15} className="text-amber-600 shrink-0" />
          <div className="text-xs text-amber-800 flex-1">
            {t(
              `${activePlatform} 目前还没有连接平台API，订单数据需要手动导入，不会自动更新。`,
              `${activePlatform} is not connected to the platform API yet — order data must be imported manually and won't auto-update.`,
            )}
          </div>
          <button onClick={() => goTo("manualimport")} className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 shrink-0">
            {t("去手动导入", "Go to Manual Import")}
          </button>
        </div>
      )}

      <div className="inline-flex bg-white border border-slate-200 rounded-xl p-1 gap-1">
        {["Shopee", "TikTok Shop"].map((pf) => {
          const pfTheme = PLATFORM_THEME[pf];
          const active = activePlatform === pf;
          return (
            <button
              key={pf}
              onClick={() => { setActivePlatform(pf); setStatusFilter("全部"); setSelectedIds(new Set()); }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active ? `${pfTheme.headerBg} text-white` : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${active ? "bg-white/80" : pfTheme.dot}`} />
              {pf}
            </button>
          );
        })}
      </div>

      <div className={`rounded-xl border ${theme.border} overflow-hidden bg-white`}>
        <div className={`${theme.headerBg} text-white px-5 py-4 flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-white/80" />
            <span className="font-semibold text-base">{activePlatform}</span>
            <span className="text-[11px] bg-white/20 px-2 py-0.5 rounded-full">{t(`${all.length} 笔订单`, `${all.length} orders`)}</span>
          </div>
          <div className="text-xs text-white/90 tabular-nums">{t("营收", "Revenue")} RM {fmt(revenue)} · {t("净利润", "Net Profit")} RM {fmt(netProfit)}</div>
        </div>

        <div className={`px-5 py-3 ${theme.bgWash} grid grid-cols-2 md:grid-cols-5 gap-3 text-xs`}>
          <button
            onClick={() => setStatusFilter("__not_shipped__")}
            className={`bg-white rounded-lg border px-3 py-2 text-left ${statusFilter === "__not_shipped__" ? "border-amber-400 ring-1 ring-amber-400" : "border-slate-200"}`}
          >
            <div className="text-slate-400">{t("待处理", "Pending")}</div>
            <div className="text-base font-semibold text-amber-600 tabular-nums">{pending}</div>
          </button>
          <button
            onClick={() => setStatusFilter("__printed__")}
            className={`bg-white rounded-lg border px-3 py-2 text-left ${statusFilter === "__printed__" ? "border-sky-400 ring-1 ring-sky-400" : "border-slate-200"}`}
          >
            <div className="text-slate-400">{t("已处理", "Processed")}</div>
            <div className="text-base font-semibold text-sky-600 tabular-nums">{processed}</div>
          </button>
          <div className="bg-white rounded-lg border border-slate-200 px-3 py-2">
            <div className="text-slate-400">{t("已签收", "Delivered")}</div>
            <div className="text-base font-semibold text-emerald-600 tabular-nums">{delivered}</div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 px-3 py-2">
            <div className="text-slate-400">{t("总订单", "Total Orders")}</div>
            <div className="text-base font-semibold text-slate-700 tabular-nums">{all.length}</div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 px-3 py-2">
            <div className="text-slate-400">{t("净利润 (RM)", "Net Profit (RM)")}</div>
            <div className="text-base font-semibold text-indigo-600 tabular-nums">{fmt(netProfit)}</div>
          </div>
        </div>

        <div className="px-5 pt-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t(`在 ${activePlatform} 内搜索订单编号 / 客户 / SKU`, `Search order no. / customer / SKU in ${activePlatform}`)}
                className={`w-full pl-8 pr-2 py-2 text-xs border border-slate-200 rounded-lg outline-none ${theme.ring}`}
              />
            </div>
            <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5">
              <Clock size={13} className="text-slate-400 shrink-0" />
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="text-xs outline-none text-slate-600 py-2"
              />
              {dateFilter && (
                <button onClick={() => setDateFilter("")} className="text-slate-400 hover:text-slate-600 shrink-0">
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2 pb-3">
            {statusChips.flatMap((s) => {
              const active = statusFilter === s;
              const chip = (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${active ? "border-sky-400 ring-1 ring-sky-400 bg-sky-50 text-sky-700" : "bg-white text-slate-500 border-slate-200"}`}
                >
                  {chipLabel(s)}
                </button>
              );
              if (s !== "待处理") return [chip];
              return [
                chip,
                <button
                  key="__printed__"
                  onClick={() => setStatusFilter("__printed__")}
                  className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${statusFilter === "__printed__" ? "border-sky-400 ring-1 ring-sky-400 bg-sky-50 text-sky-700" : "bg-white text-slate-500 border-slate-200"}`}
                >
                  {t("已处理", "Processed")}
                </button>,
              ];
            })}
          </div>
        </div>

        <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50 flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-3.5 w-3.5 rounded border-slate-300" />
            {t(`全选本页（${filtered.length} 笔）`, `Select all on this page (${filtered.length})`)}
          </label>
          <span className="text-xs text-slate-400">{t(`已选 ${selectedOrders.length} 笔`, `${selectedOrders.length} selected`)}</span>
          <button
            onClick={() => selectedOrders.length > 0 && onPrint(selectedOrders)}
            disabled={selectedOrders.length === 0}
            className={`ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg ${
              selectedOrders.length > 0 ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            <Printer size={13} /> {t(`批量打印发货单（${selectedOrders.length}）`, `Batch print shipping labels (${selectedOrders.length})`)}
          </button>
        </div>

        <div className="border-t border-slate-100 divide-y divide-slate-100">
          {filtered.length === 0 && <div className="px-5 py-6 text-xs text-slate-400 text-center">{t("没有符合条件的订单", "No orders match the current filters")}</div>}
          {filtered.map((o) => (
            <div key={o.id} className="w-full px-5 py-3 hover:bg-slate-50 flex items-start gap-3">
              <input
                type="checkbox"
                checked={selectedIds.has(o.id)}
                onChange={() => toggleOne(o.id)}
                className="h-3.5 w-3.5 mt-1.5 rounded border-slate-300 shrink-0"
              />
              <div className="flex flex-col items-stretch gap-1 w-20 shrink-0">
                <span className={`text-[10px] px-2 py-0.5 rounded-full border text-center ${statusColor(o.status)}`}>{statusLabel(o.status, lang)}</span>
                {ACTIONABLE_STATUS.includes(o.status) && (
                  <>
                    <button
                      onClick={() => onUpdateStatus(o.id, "已签收")}
                      title={t("标记为已签收", "Mark as delivered")}
                      className="text-[10px] px-2 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    >
                      {t("接收", "Receive")}
                    </button>
                    <button
                      onClick={() => onUpdateStatus(o.id, "退款中")}
                      title={t("登记退货/退款", "Log return/refund")}
                      className="text-[10px] px-2 py-1 rounded-full border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                    >
                      {t("退货", "Return")}
                    </button>
                  </>
                )}
                <button
                  onClick={() => onPrint([o])}
                  title={t("打印发货单", "Print shipping label")}
                  className="flex items-center justify-center gap-1 text-[10px] px-2 py-1 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100"
                >
                  <Printer size={11} /> {t("打印", "Print")}
                </button>
                {o.printCount > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full border text-center bg-slate-100 text-slate-500 border-slate-200">
                    {t(`已打印 ${o.printCount} 次`, `Printed ${o.printCount}x`)}
                  </span>
                )}
              </div>

              <div className="relative shrink-0 mt-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (noteEditingId === o.id) {
                      setNoteEditingId(null);
                    } else {
                      setNoteEditingId(o.id);
                      setNoteDraftText(o.noteText || "");
                      setNoteDraftColor(o.noteColor || null);
                    }
                  }}
                  title={o.noteText || t("添加备注", "Add note")}
                  className="h-4 w-4 rounded-full border border-slate-300"
                  style={o.noteColor ? { backgroundColor: NOTE_COLORS[o.noteColor], borderColor: NOTE_COLORS[o.noteColor] } : undefined}
                />
                {noteEditingId === o.id && (
                  <div className="absolute z-20 top-6 left-0 w-56 bg-white border-2 border-red-500 rounded-lg shadow-lg p-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-2 mb-2">
                      {Object.entries(NOTE_COLORS).map(([key, hex]) => (
                        <button
                          key={key}
                          onClick={() => setNoteDraftColor(key)}
                          className="h-5 w-5 rounded-full"
                          style={{ backgroundColor: hex, boxShadow: noteDraftColor === key ? "0 0 0 2px #0f172a" : "none" }}
                        />
                      ))}
                      <button
                        onClick={() => setNoteDraftColor(null)}
                        title={t("无颜色", "No color")}
                        className="h-5 w-5 rounded-full border border-slate-300 bg-white relative"
                        style={{ boxShadow: !noteDraftColor ? "0 0 0 2px #0f172a" : "none" }}
                      >
                        <span className="absolute inset-0.5 rounded-full" style={{ background: "linear-gradient(to top right, transparent 45%, #cbd5e1 47%, #cbd5e1 53%, transparent 55%)" }} />
                      </button>
                    </div>
                    <textarea
                      value={noteDraftText}
                      onChange={(e) => setNoteDraftText(e.target.value)}
                      placeholder={t("这是什么问题？", "What's the issue?")}
                      rows={2}
                      className="w-full text-xs border border-slate-200 rounded-lg p-1.5 outline-none focus:border-teal-400"
                    />
                    <button
                      onClick={() => { onUpdateNote(o.id, noteDraftColor, noteDraftText); setNoteEditingId(null); }}
                      className="mt-2 w-full text-xs py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
                    >
                      {t("保存", "Save")}
                    </button>
                  </div>
                )}
              </div>

              <button onClick={() => onOpenOrder(o)} className="min-w-0 flex-1 text-left">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="text-sm font-medium truncate">{o.id}</div>
                    {o.noteText && (
                      <span
                        className="shrink-0 truncate max-w-[100px] text-[10px] px-1.5 py-0.5 rounded-full border"
                        style={o.noteColor
                          ? { backgroundColor: `${NOTE_COLORS[o.noteColor]}1a`, borderColor: NOTE_COLORS[o.noteColor], color: NOTE_COLORS[o.noteColor] }
                          : { backgroundColor: "#f1f5f9", borderColor: "#e2e8f0", color: "#64748b" }}
                      >
                        {o.noteText}
                      </span>
                    )}
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <div className="text-xs text-slate-400 tabular-nums">{o.date}</div>
                    <div className="text-[10px] text-slate-400 tabular-nums">{o.courier || "—"} · {o.tracking}</div>
                  </div>
                </div>
                <div className="text-xs text-slate-500 truncate mt-0.5">{o.customer}</div>
                <div className="flex items-start gap-2 mt-1.5">
                  {o.productImage ? (
                    <img src={o.productImage} alt={o.product} className="h-9 w-9 rounded-lg object-cover border border-slate-200 shrink-0" />
                  ) : (
                    <div className="h-9 w-9 rounded-lg bg-slate-100 border border-slate-200 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-700 truncate">{o.product}</div>
                    <div className="text-[11px] text-slate-400 truncate mt-0.5 flex items-center gap-1">
                      <span className="truncate">
                        {o.variation ? `${o.variation} · ` : ""}{t("Seller SKU", "Seller SKU")}: {o.sku || t("（无SKU）", "(no SKU)")} × {o.qty}
                      </span>
                      {o.skuStatus === "missing" && (
                        <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-600 border border-rose-200">
                          <AlertTriangle size={9} /> {t("缺SKU", "Missing SKU")}
                        </span>
                      )}
                      {o.skuStatus === "unlinked" && (
                        <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                          <AlertTriangle size={9} /> {t("系统未登记", "Not registered")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
              <ChevronRight size={14} className="text-slate-300 mt-1 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================== Order drawer (shared) ============================== */

export function OrderDrawer({ t, order, onClose, onPrint, onUpdateStatus }) {
  const isCancelled = order.status === "已取消" || order.status === "退款中";
  const stepIdx = STATUS_STEPS.indexOf(order.status);
  const p = profit(order);
  const theme = PLATFORM_THEME[order.platform];
  const actionable = ACTIONABLE_STATUS.includes(order.status);
  const lang = t("zh", "en");

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="relative w-[420px] bg-white h-full shadow-xl overflow-y-auto">
        <div className={`flex items-center justify-between px-5 py-4 border-b border-slate-200 ${theme.bgWash}`}>
          <div>
            <div className="text-sm font-semibold flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${theme.dot}`} />
              {order.id}
            </div>
            <div className="text-xs text-slate-400">
              {order.platform} · {order.date}
              {order.platformOrderId && order.platformOrderId !== order.id && (
                <> · {t("平台订单号", "Platform order no.")} {order.platformOrderId}</>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPrint(order)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            >
              <Printer size={13} /> {t("打印发货单", "Print Shipping Label")}
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColor(order.status)}`}>{statusLabel(order.status, lang)}</span>
          </div>

          {!isCancelled && (
            <div>
              <div className="text-xs text-slate-400 mb-2">{t("订单流程追踪", "Order Progress")}</div>
              <div className="flex items-center">
                {STATUS_STEPS.map((s, i) => (
                  <div key={s} className="contents">
                    <div className="flex flex-col items-center gap-1 w-12">
                      {i <= stepIdx ? (
                        <CheckCircle size={18} className="text-teal-500" />
                      ) : (
                        <Circle size={18} className="text-slate-300" />
                      )}
                      <span className={`text-[10px] text-center ${i <= stepIdx ? "text-slate-700" : "text-slate-300"}`}>{statusLabel(s, lang)}</span>
                    </div>
                    {i < STATUS_STEPS.length - 1 && (
                      <div className={`flex-1 h-0.5 -mt-4 ${i < stepIdx ? "bg-teal-400" : "bg-slate-200"}`} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {isCancelled && (
            <div className="flex items-center gap-2 text-rose-600 text-sm bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              <AlertTriangle size={15} /> {t(`此订单已${order.status}`, `This order is already ${statusLabel(order.status, lang)}`)}
            </div>
          )}

          {actionable && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="text-xs text-slate-500">{t("客户已收货，或需登记退货？", "Has the customer received it, or need to log a return?")}</div>
              <div className="flex flex-col items-start gap-2">
                <button
                  onClick={() => onUpdateStatus(order.id, "已签收")}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <CheckCircle2 size={13} /> {t("确认接收", "Confirm Received")}
                </button>
                <button
                  onClick={() => onUpdateStatus(order.id, "退款中")}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                >
                  <AlertTriangle size={13} /> {t("登记退货", "Log Return")}
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-slate-100 pt-4 space-y-2 text-sm">
            <div className="text-xs text-slate-400 mb-1">{t("商品信息", "Product Info")}</div>
            <div className="flex justify-between"><span className="text-slate-500">{t("商品", "Product")}</span><span className="font-medium text-right">{order.product}</span></div>
            <div className="flex justify-between">
              <span className="text-slate-500">SKU</span>
              <span className={order.skuStatus === "missing" ? "text-rose-600 font-medium" : order.skuStatus === "unlinked" ? "text-amber-700 font-medium" : ""}>
                {order.sku || t("（无SKU）", "(no SKU)")}
                {order.skuStatus === "missing" && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-600 border border-rose-200 align-middle">{t("⚠ CSV未填，请补充", "⚠ Missing in CSV, please fill in")}</span>}
                {order.skuStatus === "unlinked" && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 align-middle">{t("⚠ 系统未登记此SKU", "⚠ SKU not registered in system")}</span>}
              </span>
            </div>
            <div className="flex justify-between"><span className="text-slate-500">{t("数量", "Qty")}</span><span className="tabular-nums">{order.qty}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{t("客户", "Customer")}</span><span>{order.customer}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{t("出货仓库", "Ship-from Warehouse")}</span><span>{warehouseLabel(order.warehouse, lang)}</span></div>
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-2 text-sm">
            <div className="text-xs text-slate-400 mb-1 flex items-center gap-1"><Truck size={12}/> {t("物流信息", "Logistics Info")}</div>
            <div className="flex justify-between"><span className="text-slate-500">{t("追踪号码", "Tracking No.")}</span><span className="tabular-nums">{order.tracking}</span></div>
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-2 text-sm">
            <div className="text-xs text-slate-400 mb-1">{t("费用与利润", "Fees & Profit")}</div>
            <div className="flex justify-between"><span className="text-slate-500">{t("商品金额", "Product Amount")}</span><span className="tabular-nums">RM {fmt(order.unitPrice * order.qty)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{t("运费", "Shipping Fee")}</span><span className="tabular-nums">RM {fmt(order.shippingFee)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{t("平台费用", "Platform Fee")}</span><span className="tabular-nums">- RM {fmt(order.platformFee)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{t("佣金", "Commission")}</span><span className="tabular-nums">- RM {fmt(order.commission)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">{t("成本", "Cost")}</span><span className="tabular-nums">- RM {fmt(order.cost * order.qty)}</span></div>
            <div className="flex justify-between font-semibold pt-2 border-t border-slate-100">
              <span>{t("净利润", "Net Profit")}</span>
              <span className={`tabular-nums ${p >= 0 ? "text-emerald-600" : "text-rose-600"}`}>RM {fmt(p)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================== Inventory ============================== */

export function Inventory({ t, inventory, stores }) {
  const [wh, setWh] = useState("全部");
  const lang = t("zh", "en");
  function shopName(id) {
    return stores.find((s) => s.id === id)?.name || "—";
  }
  const whLabel = (w) => (w === "全部" ? t("全部", "All") : warehouseLabel(w, lang));
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {["全部", "吉隆坡仓", "柔佛仓"].map((w) => (
          <button
            key={w}
            onClick={() => setWh(w)}
            className={`px-3 py-1.5 text-xs rounded-full border ${wh === w ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"}`}
          >
            {whLabel(w)}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
              <th className="py-2 pr-3 font-medium">SKU</th>
              <th className="py-2 pr-3 font-medium">{t("商品名称", "Product Name")}</th>
              <th className="py-2 pr-3 font-medium">{t("吉隆坡仓", "KL Warehouse")}</th>
              <th className="py-2 pr-3 font-medium">{t("柔佛仓", "Johor Warehouse")}</th>
              <th className="py-2 pr-3 font-medium">{t("总库存", "Total Stock")}</th>
              <th className="py-2 pr-3 font-medium">{t("平台链接", "Platform Link")}</th>
              <th className="py-2 pr-3 font-medium">{t("所属店铺", "Store")}</th>
              <th className="py-2 pr-3 font-medium">{t("状态", "Status")}</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map((item) => {
              const total = item.warehouseA + item.warehouseB;
              const low = total < item.reorderPoint;
              return (
                <tr key={item.sku} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="py-2.5 pr-3 font-medium">{item.sku}</td>
                  <td className="py-2.5 pr-3">{item.name}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{wh === "柔佛仓" ? "—" : item.warehouseA}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{wh === "吉隆坡仓" ? "—" : item.warehouseB}</td>
                  <td className="py-2.5 pr-3 tabular-nums font-medium">{total}</td>
                  <td className="py-2.5 pr-3">
                    <div className="flex gap-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${item.shopeeLinked ? "bg-orange-50 text-orange-600 border-orange-200" : "bg-slate-50 text-slate-300 border-slate-200"}`}>Shopee</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${item.tiktokLinked ? "bg-rose-50 text-rose-600 border-rose-200" : "bg-slate-50 text-slate-300 border-slate-200"}`}>TikTok</span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-slate-500">{shopName(item.listedShop)}</td>
                  <td className="py-2.5 pr-3">
                    {low ? (
                      <span className="text-xs px-2 py-0.5 rounded-full border bg-rose-100 text-rose-700 border-rose-200 inline-flex items-center gap-1"><AlertTriangle size={11} /> {t("低库存", "Low Stock")}</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full border bg-emerald-100 text-emerald-700 border-emerald-200 inline-flex items-center gap-1"><CheckCircle2 size={11} /> {t("充足", "Sufficient")}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
