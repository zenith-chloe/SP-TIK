import { useState, useMemo, useEffect } from "react";
import {
  Search, X, ChevronRight, AlertTriangle, CheckCircle2, Truck, Circle,
  CheckCircle, Printer, Clock, Info, MapPin, PackagePlus, PackageMinus, SlidersHorizontal,
  Plus, Trash2, Warehouse as WarehouseIcon, ChevronDown,
  Package, CreditCard, ShoppingCart, RotateCcw, XCircle,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import {
  PLATFORM_THEME, SALES_TREND, STATUS_STEPS, ACTIONABLE_STATUS,
  profit, fmt, statusColor, statusLabel, warehouseLabel, supabaseClient,
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
  const pending = orders.filter((o) => o.status === "待处理" && o.platformStatus !== "UNPAID" && !(o.printCount > 0)).length;
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

/* ============================== Order status cards ============================== */

// Status-card row shown at the top of Orders (订单管理中心) — merged in
// 2026-07-28 from what used to be a separate "orderCenter" dashboard tab,
// per a reference screenshot that shows both in one page. Each `match`
// predicate reads platformStatus/orderStatus, both already present on every
// mapped order (see mapDbOrder in shared.jsx) — no new fetch, no schema
// change, same predicates as before the merge.
//
// 投递失败 will show 0 today: the real TikTok/Shopee platform_status string
// that would populate it has never appeared in this system's synced data
// (checked live — 7,355 real orders) — 0 is an honest count of what's
// actually there, not a bug. (待取货 used to be in this same boat via its
// own platformStatus==='AWAITING_COLLECTION' check — as of 2026-07-29 its
// card reads print_count>0 instead, real ERP data, so it's no longer
// permanently zero; see ORDER_STATUS_LABELS.toPickup below.)
//
// Single source of truth for every status name shown anywhere in this page
// (2026-07-29) — the status cards above and the filter chips below had
// drifted (an extra "出货" chip with no card counterpart; earlier passes had
// also left "包装"/leftover demo vocabulary around). Both the card grid and
// the chip row now read their zh/en text from here, so the two can't drift
// apart again. Old demo-status words (待处理/已处理/包装/出货) are gone from
// display entirely — 待发货 and 待取货 are what those two used to be called,
// nothing new; 出货 had no equivalent among these 9 names and is dropped
// (its real order_status='shipped' data still exists in the DB, it's just
// no longer surfaced by any chip in this row — flagged to the user).
const ORDER_STATUS_LABELS = {
  all: { zh: "全部", en: "All" },
  unpaid: { zh: "未付款", en: "Unpaid" },
  toShip: { zh: "待发货", en: "To Ship" }, // = 原 ERP 待处理 (__not_shipped__) — chip logic unchanged, display-name-only; card's `match` was aligned to this same logic (2026-07-29) after a live audit found it had been using platformStatus==='AWAITING_SHIPMENT' instead, overcounting by exactly the orders already printed (printCount>0) — see ORDER_CENTER_CARDS below
  toPickup: { zh: "待取货", en: "To Pickup" }, // = 原 ERP 已处理 (__printed__/print_count>0) — real platform AWAITING_COLLECTION data has never appeared (checked live), so this stays on the real ERP-internal state per "ERP没有对应状态，不强行制造"
  inTransit: { zh: "运输中", en: "In Transit" }, // = real platformStatus === "IN_TRANSIT" (2026-07-29: was the dead o.status==="物流中")
  delivered: { zh: "已送达", en: "Delivered" }, // = real platformStatus IN ("DELIVERED","COMPLETED") (2026-07-29: was the dead o.status==="已签收")
  failed: { zh: "投递失败", en: "Delivery Failed" }, // no real data yet
  returned: { zh: "退货/退款", en: "Return/Refund" }, // = o.status === "退款中"
  cancelled: { zh: "已取消", en: "Cancelled" }, // = o.status === "已取消"
};

// Card border is neutral gray by default; icon/number colors are permanent
// and never change (untouched by selection state). Each card's `filterValue`
// matches the status chip row's values below purely so the card can pick up
// the same unified purple highlight the chips use when that exact status is
// selected — a visual link only, not a click target (cards still have no
// onClick, still can't change the filter themselves). 未付款/投递失败 have no
// filterValue (same as their disabled chip counterparts) so they can never
// highlight.
const ORDER_CENTER_CARDS = [
  { key: "all", ...ORDER_STATUS_LABELS.all, filterValue: "全部", iconBg: "bg-amber-100", iconColor: "text-amber-600", numberColor: "text-amber-600", icon: Package, match: () => true },
  { key: "unpaid", ...ORDER_STATUS_LABELS.unpaid, iconBg: "bg-pink-100", iconColor: "text-pink-600", numberColor: "text-pink-600", icon: CreditCard, match: (o) => o.platformStatus === "UNPAID" },
  { key: "toShip", ...ORDER_STATUS_LABELS.toShip, filterValue: "__not_shipped__", iconBg: "bg-red-100", iconColor: "text-red-600", numberColor: "text-red-600", icon: PackagePlus, match: (o) => o.status === "待处理" && o.platformStatus !== "UNPAID" && !((o.printCount || 0) > 0) },
  { key: "toPickup", ...ORDER_STATUS_LABELS.toPickup, filterValue: "__printed__", iconBg: "bg-blue-100", iconColor: "text-blue-600", numberColor: "text-blue-600", icon: ShoppingCart, match: (o) => (o.printCount || 0) > 0 },
  { key: "inTransit", ...ORDER_STATUS_LABELS.inTransit, filterValue: "__in_transit__", iconBg: "bg-purple-100", iconColor: "text-purple-600", numberColor: "text-purple-600", icon: Truck, match: (o) => o.platformStatus === "IN_TRANSIT" },
  { key: "delivered", ...ORDER_STATUS_LABELS.delivered, filterValue: "__delivered__", iconBg: "bg-green-100", iconColor: "text-green-600", numberColor: "text-green-600", icon: CheckCircle, match: (o) => o.platformStatus === "DELIVERED" || o.platformStatus === "COMPLETED" },
  { key: "returned", ...ORDER_STATUS_LABELS.returned, filterValue: "退款中", iconBg: "bg-rose-100", iconColor: "text-rose-600", numberColor: "text-rose-600", icon: RotateCcw, match: (o) => o.orderStatus === "returned" },
];

// 8th grid slot: 投递失败 (top, gray, no filterValue — never highlights) +
// 已取消 (bottom, orange, filterValue "已取消" — highlights the whole shared
// outer border, same as any other card, when that chip is selected).
const FAILED_CANCELLED_SPLIT_CARD = {
  top: { ...ORDER_STATUS_LABELS.failed, iconBg: "bg-slate-100", iconColor: "text-slate-500", numberColor: "text-slate-500", icon: AlertTriangle, match: (o) => o.platformStatus === "FAILED_DELIVERY" || o.platformStatus === "UNDELIVERED" },
  bottom: { ...ORDER_STATUS_LABELS.cancelled, filterValue: "已取消", iconBg: "bg-orange-100", iconColor: "text-orange-600", numberColor: "text-orange-600", icon: XCircle, match: (o) => o.orderStatus === "cancelled" },
};

/* ============================== Orders (订单列表) ============================== */

const NOTE_COLORS = { red: "#ef4444", yellow: "#eab308", purple: "#a855f7" };

export function Orders({ t, orders, stores, onOpenOrder, onPrint, onConfirmProcess, onUpdateStatus, onUpdateNote, goTo }) {
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
  // Status-chip row — text sourced from the same `ORDER_STATUS_LABELS` the
  // cards above use, so the two rows can't drift apart. Exactly the 9 names
  // shown on the cards, same order. As of 2026-07-29: 运输中/已送达 now filter
  // by the same real `platformStatus` field their cards already used (see
  // `filtered`'s `__in_transit__`/`__delivered__` branches above) instead of
  // the two dead demo-status values they used to point at — every card's
  // count and its matching chip's filter now agree because both read the
  // exact same condition. 待发货 stays on the original 待处理-derived logic
  // (display-name-only rename, per explicit instruction not to touch it);
  // 待取货 stays on print_count>0 (real ERP data — the platform's own
  // AWAITING_COLLECTION has never appeared in any real synced order, so per
  // "如果ERP没有对应状态，不强行制造" this was left alone, and the card next
  // to it was changed to match instead — see ORDER_CENTER_CARDS above).
  const STATUS_CHIPS = [
    { ...ORDER_STATUS_LABELS.all, filterValue: "全部" },
    { ...ORDER_STATUS_LABELS.unpaid, disabled: true },
    { ...ORDER_STATUS_LABELS.toShip, filterValue: "__not_shipped__" },
    { ...ORDER_STATUS_LABELS.toPickup, filterValue: "__printed__" },
    { ...ORDER_STATUS_LABELS.inTransit, filterValue: "__in_transit__" },
    { ...ORDER_STATUS_LABELS.delivered, filterValue: "__delivered__" },
    { ...ORDER_STATUS_LABELS.failed, disabled: true },
    { ...ORDER_STATUS_LABELS.returned, filterValue: "退款中" },
    { ...ORDER_STATUS_LABELS.cancelled, filterValue: "已取消" },
  ];
  // Unified active style (2026-07-29) — every chip uses the exact same
  // purple highlight when selected, regardless of which status it is; no
  // more per-chip color (there used to be amber/rose/emerald/sky depending
  // on status). This is deliberately independent of the status cards' colors
  // above — a pure filter-UI interaction convention, not a status taxonomy.
  const CHIP_ACTIVE_CLASS = "border-purple-400 ring-1 ring-purple-400 bg-purple-50 text-purple-700";

  // 还没交给物流 = 官方平台的 "To Ship"：待处理里已付款的部分（不含未付款 UNPAID，平台的 To Ship 不算未付款单）
  const NOT_YET_SHIPPED = ["待处理"];
  const isNotYetShipped = (o) => NOT_YET_SHIPPED.includes(o.status) && o.platformStatus !== "UNPAID" && !(o.printCount > 0);
  const platformStores = stores.filter((s) => s.platform === activePlatform);
  const allManual = platformStores.length > 0 && platformStores.every((s) => s.syncMode === "manual");

  const all = useMemo(() => orders.filter((o) => o.platform === activePlatform), [orders, activePlatform]);
  const revenue = all.filter((o) => o.status !== "已取消").reduce((s, o) => s + o.unitPrice * o.qty, 0);
  const netProfit = all.filter((o) => o.status !== "已取消").reduce((s, o) => s + profit(o), 0);

  const filtered = useMemo(() => {
    return all.filter((o) => {
      if (statusFilter === "__not_shipped__") {
        if (!isNotYetShipped(o)) return false;
      } else if (statusFilter === "__printed__") {
        if (!((o.printCount || 0) > 0)) return false;
      } else if (statusFilter === "__in_transit__") {
        // 运输中 (2026-07-29): was o.status === "物流中", a demo-status value
        // DB_TO_DEMO_STATUS never actually produces for any real order — the
        // 运输中 card next to this chip was already reading real data via
        // platformStatus, so the chip is now pointed at the same real field
        // instead of the dead one, per explicit instruction to connect real
        // platform state where the DB genuinely has it.
        if (o.platformStatus !== "IN_TRANSIT") return false;
      } else if (statusFilter === "__delivered__") {
        // 已送达 (2026-07-29): was o.status === "已签收", which is even less
        // real than 物流中 — DB_TO_DEMO_STATUS never produces it either, and
        // it only ever existed as a transient local-only value set by the
        // OrderDrawer's "确认接收" button (which itself persists order_status
        // as 'shipped', not anything that maps back to 已签收). Same fix:
        // point at the real platformStatus field the card already uses.
        if (!(o.platformStatus === "DELIVERED" || o.platformStatus === "COMPLETED")) return false;
      } else if (statusFilter !== "全部" && o.status !== statusFilter) {
        return false;
      }
      if (dateFilter && o.date !== dateFilter) return false;
      if (q && !(o.id.toLowerCase().includes(q.toLowerCase()) || o.customer.includes(q) || (o.sku || "").toLowerCase().includes(q.toLowerCase()))) return false;
      return true;
    });
  }, [all, statusFilter, dateFilter, q]);

  const allChecked = filtered.length > 0 && filtered.every((o) => selectedIds.has(o.id));
  // Batch-printed labels come out oldest-first (FIFO), not in click/selection
  // order, so a warehouse batch always prints in a predictable sequence.
  const selectedOrders = filtered.filter((o) => selectedIds.has(o.id)).sort((a, b) => a.date.localeCompare(b.date));

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

        {/* Status-card grid — merged in from the former standalone "订单管理中心"
            dashboard tab (2026-07-28, per reference screenshot), 4 cols x 2
            rows, scoped to the currently-active platform (`all`, already
            filtered above). Clicking a card (2026-07-29) sets the exact same
            `statusFilter` its matching chip below does — same `filterValue`,
            same `setStatusFilter` call, so results are guaranteed identical
            to clicking the chip, not a separate filter path. Only cards with
            a `filterValue` are clickable (未付款/投递失败 have none — no real
            status to reuse, so they stay plain, per "不要重新定义状态，只复用
            现在已经确认好的 mapping"). Border goes purple when active — same
            unified purple the chip row uses; icon/number colors and label
            text never change either way. */}
        <div className={`px-5 py-3 ${theme.bgWash} grid grid-cols-2 md:grid-cols-4 gap-3`}>
          {ORDER_CENTER_CARDS.map((card) => {
            const count = all.filter(card.match).length;
            const Icon = card.icon;
            const clickable = card.filterValue !== undefined;
            const active = clickable && statusFilter === card.filterValue;
            const CardTag = clickable ? "button" : "div";
            return (
              <CardTag
                key={card.key}
                type={clickable ? "button" : undefined}
                onClick={clickable ? () => setStatusFilter(card.filterValue) : undefined}
                className={`bg-white rounded-lg border-2 ${active ? "border-purple-400" : "border-slate-200"} px-3 py-3 flex flex-col items-center justify-center gap-1.5 ${clickable ? "cursor-pointer hover:border-slate-300" : ""}`}
              >
                <div className={`h-8 w-8 rounded-full flex items-center justify-center ${card.iconBg}`}>
                  <Icon size={14} className={card.iconColor} />
                </div>
                <div className="text-xs text-slate-500">{t(card.zh, card.en)}</div>
                <div className={`text-lg font-bold tabular-nums ${card.numberColor}`}>{count}</div>
              </CardTag>
            );
          })}
          {/* 8th slot: 投递失败 + 已取消 in one card — same outer rounded/
              background as the other 7, each half reusing the same icon-
              then-label-then-number vertical stack (just smaller) so it reads
              as one unified stat card. Only the 已取消 half is clickable (same
              filterValue its chip uses); 投递失败 has no filterValue, stays
              plain. The shared outer border goes purple when 已取消 is active. */}
          <div className={`bg-white rounded-lg border-2 ${statusFilter === "已取消" ? "border-purple-400" : "border-slate-200"} flex flex-col divide-y divide-slate-100`}>
            {[FAILED_CANCELLED_SPLIT_CARD.top, FAILED_CANCELLED_SPLIT_CARD.bottom].map((half) => {
              const count = all.filter(half.match).length;
              const Icon = half.icon;
              const clickable = half.filterValue !== undefined;
              const HalfTag = clickable ? "button" : "div";
              return (
                <HalfTag
                  key={half.zh}
                  type={clickable ? "button" : undefined}
                  onClick={clickable ? () => setStatusFilter(half.filterValue) : undefined}
                  className={`flex-1 w-full flex flex-col items-center justify-center gap-1 py-1.5 ${clickable ? "cursor-pointer hover:bg-slate-50" : ""}`}
                >
                  <div className={`h-6 w-6 rounded-full flex items-center justify-center ${half.iconBg}`}>
                    <Icon size={12} className={half.iconColor} />
                  </div>
                  <div className="text-[11px] text-slate-500 leading-none">{t(half.zh, half.en)}</div>
                  <div className={`text-sm font-bold tabular-nums leading-none ${half.numberColor}`}>{count}</div>
                </HalfTag>
              );
            })}
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
            {STATUS_CHIPS.map((chip) => {
              if (chip.disabled) {
                return (
                  <button
                    key={chip.zh}
                    disabled
                    title={t("该状态目前没有对应的真实筛选数据，UI 位置已保留，暂不可点击", "No real filter data for this status yet — slot reserved, not clickable")}
                    className="px-2.5 py-1 text-[11px] rounded-full border bg-white text-slate-500 border-slate-200"
                  >
                    {t(chip.zh, chip.en)}
                  </button>
                );
              }
              const active = statusFilter === chip.filterValue;
              return (
                <button
                  key={chip.zh}
                  onClick={() => setStatusFilter(chip.filterValue)}
                  className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${active ? CHIP_ACTIVE_CLASS : "bg-white text-slate-500 border-slate-200"}`}
                >
                  {t(chip.zh, chip.en)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50 flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-3.5 w-3.5 rounded border-slate-300" />
            {t(`全选本页（${filtered.length} 笔）`, `Select all on this page (${filtered.length})`)}
          </label>
          <span className="text-xs text-slate-400">{t(`已选 ${selectedOrders.length} 笔`, `${selectedOrders.length} selected`)}</span>
          {(() => {
            const selectedPending = selectedOrders.filter((o) => o.orderStatus === "pending");
            return (
              <button
                onClick={() => selectedPending.length > 0 && onConfirmProcess(selectedPending.map((o) => o.id))}
                disabled={selectedPending.length === 0}
                title={t("将已选订单从待处理推进到已处理，与打印无关", "Moves selected orders from To Process to Processed — independent of printing")}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg ml-auto ${
                  selectedPending.length > 0 ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"
                }`}
              >
                <CheckCircle2 size={13} /> {t(`确认处理（${selectedPending.length}）`, `Confirm Process (${selectedPending.length})`)}
              </button>
            );
          })()}
          <button
            onClick={() => selectedOrders.length > 0 && onPrint(selectedOrders)}
            disabled={selectedOrders.length === 0}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg ${
              selectedOrders.length > 0 ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            <Printer size={13} /> {t(`批量打印订单单（${selectedOrders.length}）`, `Batch print order slips (${selectedOrders.length})`)}
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
                {o.orderStatus === "pending" && (
                  <button
                    onClick={() => onConfirmProcess([o.id])}
                    title={t("确认处理：推进到已处理，与打印无关", "Confirm Process — moves to Processed, independent of printing")}
                    className="flex items-center justify-center gap-1 text-[10px] px-2 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  >
                    <CheckCircle2 size={11} /> {t("确认处理", "Confirm Process")}
                  </button>
                )}
                <button
                  onClick={() => onPrint([o])}
                  title={t("打印订单单", "Print order slip")}
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
              <Printer size={13} /> {t("打印订单单", "Print Order Slip")}
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

// Reserved quantity per SKU: total qty still needed by orders that have
// entered the warehouse pipeline but haven't shipped yet. Filtered as
// "anything not yet at ready_ship" (rather than an explicit list of the
// in-between stages) so it stays correct if 'picking'/'packing'/'packed'
// ever start getting used by a future "start picking"/"start packing"
// action — those are already valid warehouse_stage values (see the
// migration) but no button sets them today. Computed fresh on every call,
// not a stored counter — nothing to keep in sync, no write path, and no
// touch to the TikTok/Shopee sync functions. Chunk + range() pagination
// mirrors fetchOrderItemsFor/fetchPickingItemsByOrderNo elsewhere in the app.
async function fetchReservedQtyBySku() {
  const { data: pipelineOrders, error: ordersErr } = await supabaseClient
    .from("orders")
    .select("id")
    .neq("warehouse_stage", "ready_ship")
    .neq("order_status", "cancelled");
  if (ordersErr || !pipelineOrders || pipelineOrders.length === 0) return {};

  const orderIds = pipelineOrders.map((o) => o.id);
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
        .select("sku, qty")
        .in("order_id", chunk)
        .range(from, from + PAGE_SIZE - 1);
      if (error) { console.error("fetchReservedQtyBySku chunk failed", error); break; }
      all.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return all;
  }

  const items = (await Promise.all(chunks.map(fetchChunk))).flat();
  const bySku = {};
  items.forEach((it) => { bySku[it.sku] = (bySku[it.sku] || 0) + (it.qty || 0); });
  return bySku;
}

const MOVEMENT_TYPES = [
  { key: "stock_in", zh: "入库", en: "Stock In", icon: PackagePlus },
  { key: "stock_out", zh: "出库", en: "Stock Out", icon: PackageMinus },
  { key: "adjustment", zh: "库存调整", en: "Adjustment", icon: SlidersHorizontal },
];

// Manual stock-in/out/adjustment form — reason is required (per "完整记录
// 原因") since this is the one place stock can change outside an order, so
// the ledger needs to explain why every time. Adjustment takes the counted
// absolute quantity (matches how a physical stocktake actually works —
// staff read a number off the shelf, they don't compute a delta), the other
// two types take a plain positive quantity with direction implied by type.
function StockMovementForm({ t, item, onCancel, onSave }) {
  const [type, setType] = useState("stock_in");
  const [warehouse, setWarehouse] = useState("A");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lang = t("zh", "en");

  const currentQty = warehouse === "B" ? item.warehouseB : item.warehouseA;

  async function handleSave() {
    if (!reason.trim()) { setError(t("请填写原因", "Reason is required")); return; }
    if (qty === "" || Number.isNaN(Number(qty))) { setError(t("请填写数量", "Quantity is required")); return; }
    setSaving(true);
    setError("");
    const result = await onSave({
      movementType: type,
      warehouse,
      qty: type !== "adjustment" ? Number(qty) : undefined,
      targetQty: type === "adjustment" ? Number(qty) : undefined,
      reason: reason.trim(),
    });
    setSaving(false);
    if (result?.error) setError(result.error);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="text-sm font-medium">{t("库存调整", "Stock Adjustment")} · {item.sku}</div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          {error && (
            <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border bg-rose-50 text-rose-600 border-rose-200">
              <AlertTriangle size={13} /> {error}
            </div>
          )}
          <div className="flex gap-2">
            {MOVEMENT_TYPES.map((mt) => (
              <button
                key={mt.key}
                onClick={() => setType(mt.key)}
                className={`flex-1 flex items-center justify-center gap-1 text-xs px-2 py-2 rounded-lg border ${type === mt.key ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"}`}
              >
                <mt.icon size={13} /> {lang === "en" ? mt.en : mt.zh}
              </button>
            ))}
          </div>
          <div>
            <label className="text-[11px] text-slate-400 mb-1 block">{t("仓库", "Warehouse")}</label>
            <select
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400"
            >
              <option value="A">{t("吉隆坡仓", "KL Warehouse")}</option>
              <option value="B">{t("柔佛仓", "Johor Warehouse")}</option>
            </select>
            <div className="text-[11px] text-slate-400 mt-1">{t("当前库存", "Current stock")}: {currentQty}</div>
          </div>
          <div>
            <label className="text-[11px] text-slate-400 mb-1 block">
              {type === "adjustment" ? t("盘点数量（调整为）", "Counted Quantity (set to)") : t("数量", "Quantity")}
            </label>
            <input
              type="number"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400"
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-400 mb-1 block">{t("原因", "Reason")}</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("例：供应商到货 / 盘点差异 / 损坏报废", "e.g. supplier delivery / stocktake variance / damaged goods")}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">{t("取消", "Cancel")}</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300"
          >
            {saving ? t("保存中…", "Saving…") : t("确认", "Confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

const LEVEL_LABELS = {
  warehouse: { zh: "仓库", en: "Warehouse" },
  zone: { zh: "区域", en: "Zone" },
  shelf: { zh: "货架", en: "Shelf" },
  bin: { zh: "库位", en: "Bin" },
};
const NEXT_LEVEL = { warehouse: "zone", zone: "shelf", shelf: "bin" };

// Resolves a bin id to its full path for display, e.g. "吉隆坡仓 > A区 > 3号架 > 01号位".
function resolveLocationPath(locationId, allLocations) {
  if (!locationId) return null;
  const byId = new Map(allLocations.map((l) => [l.id, l]));
  const parts = [];
  let cur = byId.get(locationId);
  while (cur) {
    parts.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return parts.length ? parts.join(" > ") : null;
}

// One node in the warehouse/zone/shelf/bin tree — recurses into its own
// children. Warehouse-level nodes (the two seeded ones) can't be renamed or
// deleted here, only their descendants can; that's enforced by simply not
// rendering a delete button at that level, matching how the two warehouses
// are meant to stay in lockstep with products.warehouse_a_qty/b_qty.
function LocationNode({ t, node, allLocations, onCreate, onDelete, depth }) {
  const [open, setOpen] = useState(depth === 0);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const lang = t("zh", "en");
  const nextLevel = NEXT_LEVEL[node.level];
  const kids = allLocations.filter((l) => l.parent_id === node.id);

  async function handleAdd() {
    if (!code.trim() || !name.trim()) return;
    const result = await onCreate({ parentId: node.id, level: nextLevel, code: code.trim(), name: name.trim() });
    if (!result?.error) {
      setCode("");
      setName("");
      setAdding(false);
      setOpen(true);
    }
  }

  return (
    <div style={{ marginLeft: depth * 18 }}>
      <div className="flex items-center gap-1.5 py-1 text-xs">
        {kids.length > 0 ? (
          <button onClick={() => setOpen((v) => !v)} className="text-slate-400 shrink-0">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="font-medium">{node.name}</span>
        <span className="text-[10px] text-slate-400">({node.code})</span>
        {nextLevel && (
          <button onClick={() => setAdding((v) => !v)} className="text-[10px] text-teal-600 flex items-center gap-0.5 hover:text-teal-700">
            <Plus size={10} /> {t(`添加${LEVEL_LABELS[nextLevel].zh}`, `Add ${LEVEL_LABELS[nextLevel].en}`)}
          </button>
        )}
        {node.level !== "warehouse" && (
          <button onClick={() => onDelete(node.id)} className="text-slate-300 hover:text-rose-600">
            <Trash2 size={11} />
          </button>
        )}
      </div>
      {adding && (
        <div className="flex items-center gap-1 mb-1" style={{ marginLeft: 18 }}>
          <input
            placeholder={t("编号", "Code")}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-16 px-1.5 py-0.5 text-[11px] border border-slate-200 rounded outline-none focus:border-slate-400"
          />
          <input
            placeholder={t("名称", "Name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-28 px-1.5 py-0.5 text-[11px] border border-slate-200 rounded outline-none focus:border-slate-400"
          />
          <button onClick={handleAdd} className="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-white">{t("确定", "OK")}</button>
        </div>
      )}
      {open && kids.map((k) => (
        <LocationNode key={k.id} t={t} node={k} allLocations={allLocations} onCreate={onCreate} onDelete={onDelete} depth={depth + 1} />
      ))}
    </div>
  );
}

// Collapsible panel for building out the zone/shelf/bin tree under each of
// the two (fixed) warehouses. Separate concern from binding a specific SKU
// to a bin — this is where the bins get created in the first place.
function WarehouseLocationManager({ t, warehouseLocations, onCreateLocation, onDeleteLocation }) {
  const [open, setOpen] = useState(false);
  const roots = warehouseLocations.filter((l) => l.level === "warehouse");

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between text-sm font-medium">
        <span className="flex items-center gap-1.5"><WarehouseIcon size={14} className="text-slate-500" /> {t("仓库位置管理（仓库/区域/货架/库位）", "Warehouse Location Management (Warehouse/Zone/Shelf/Bin)")}</span>
        <span className="text-xs text-slate-400">{open ? t("收起", "Collapse") : t("展开", "Expand")}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-1 border-t border-slate-100 pt-3">
          {roots.map((r) => (
            <LocationNode key={r.id} t={t} node={r} allLocations={warehouseLocations} onCreate={onCreateLocation} onDelete={onDeleteLocation} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}

// Cascading warehouse -> zone -> shelf -> bin picker to bind one SKU to a
// specific bin (products.location_id). Each level only lists children of
// the level above; if a level has nothing yet, points the user at
// WarehouseLocationManager instead of failing silently.
function LocationBindForm({ t, item, allLocations, onCancel, onSave }) {
  const existing = allLocations.find((l) => l.id === item.locationId);
  const chain = [];
  if (existing) {
    const byId = new Map(allLocations.map((l) => [l.id, l]));
    let cur = existing;
    while (cur) { chain.unshift(cur); cur = cur.parent_id ? byId.get(cur.parent_id) : null; }
  }
  const [warehouseId, setWarehouseId] = useState(chain[0]?.id || "");
  const [zoneId, setZoneId] = useState(chain[1]?.id || "");
  const [shelfId, setShelfId] = useState(chain[2]?.id || "");
  const [binId, setBinId] = useState(chain[3]?.id || "");

  const warehouses = allLocations.filter((l) => l.level === "warehouse");
  const zones = allLocations.filter((l) => l.level === "zone" && l.parent_id === warehouseId);
  const shelves = allLocations.filter((l) => l.level === "shelf" && l.parent_id === zoneId);
  const bins = allLocations.filter((l) => l.level === "bin" && l.parent_id === shelfId);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="text-sm font-medium">{t("绑定仓库位置", "Bind Warehouse Location")} · {item.sku}</div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <select
            value={warehouseId}
            onChange={(e) => { setWarehouseId(e.target.value); setZoneId(""); setShelfId(""); setBinId(""); }}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400"
          >
            <option value="">{t("选择仓库", "Select warehouse")}</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select
            value={zoneId}
            onChange={(e) => { setZoneId(e.target.value); setShelfId(""); setBinId(""); }}
            disabled={!warehouseId}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400 disabled:bg-slate-50"
          >
            <option value="">{t("选择区域", "Select zone")}</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
          <select
            value={shelfId}
            onChange={(e) => { setShelfId(e.target.value); setBinId(""); }}
            disabled={!zoneId}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400 disabled:bg-slate-50"
          >
            <option value="">{t("选择货架", "Select shelf")}</option>
            {shelves.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select
            value={binId}
            onChange={(e) => setBinId(e.target.value)}
            disabled={!shelfId}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400 disabled:bg-slate-50"
          >
            <option value="">{t("选择库位", "Select bin")}</option>
            {bins.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {warehouseId && zones.length === 0 && (
            <div className="text-[11px] text-amber-600">{t("该仓库还没有区域，请先在上方「仓库位置管理」创建", "No zones yet — create one in Warehouse Location Management above first")}</div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">{t("取消", "Cancel")}</button>
          <button
            onClick={() => onSave(binId || null)}
            disabled={!binId}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300"
          >
            {t("确认", "Confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Inventory({ t, inventory, stores, onUpdateLocation, onRecordMovement, warehouseLocations = [], onCreateLocation, onDeleteLocation, onBindLocation }) {
  const [wh, setWh] = useState("全部");
  const [reservedBySku, setReservedBySku] = useState({});
  const [editingLocationSku, setEditingLocationSku] = useState(null);
  const [locationDraft, setLocationDraft] = useState("");
  const [movementItem, setMovementItem] = useState(null);
  const lang = t("zh", "en");

  useEffect(() => {
    let cancelled = false;
    fetchReservedQtyBySku().then((bySku) => { if (!cancelled) setReservedBySku(bySku); });
    return () => { cancelled = true; };
  }, [inventory]);

  function shopName(id) {
    return stores.find((s) => s.id === id)?.name || "—";
  }
  const whLabel = (w) => (w === "全部" ? t("全部", "All") : warehouseLabel(w, lang));

  function startEditLocation(item) {
    setEditingLocationSku(item.sku);
    setLocationDraft(item.location || "");
  }
  function saveLocation(sku) {
    onUpdateLocation?.(sku, locationDraft.trim());
    setEditingLocationSku(null);
  }

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
        <table className="w-full text-sm min-w-[960px]">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
              <th className="py-2 pr-3 font-medium">SKU</th>
              <th className="py-2 pr-3 font-medium">{t("商品名称", "Product Name")}</th>
              <th className="py-2 pr-3 font-medium">{t("吉隆坡仓", "KL Warehouse")}</th>
              <th className="py-2 pr-3 font-medium">{t("柔佛仓", "Johor Warehouse")}</th>
              <th className="py-2 pr-3 font-medium">{t("总库存", "Total Stock")}</th>
              <th className="py-2 pr-3 font-medium">{t("已锁定", "Reserved")}</th>
              <th className="py-2 pr-3 font-medium">{t("可用库存", "Available")}</th>
              <th className="py-2 pr-3 font-medium">{t("仓库位置", "Location")}</th>
              <th className="py-2 pr-3 font-medium">{t("平台链接", "Platform Link")}</th>
              <th className="py-2 pr-3 font-medium">{t("所属店铺", "Store")}</th>
              <th className="py-2 pr-3 font-medium">{t("状态", "Status")}</th>
              <th className="py-2 pr-3 font-medium">{t("操作", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map((item) => {
              const total = item.warehouseA + item.warehouseB;
              const reserved = reservedBySku[item.sku] || 0;
              const available = Math.max(total - reserved, 0);
              const low = total < item.reorderPoint;
              return (
                <tr key={item.sku} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="py-2.5 pr-3 font-medium">{item.sku}</td>
                  <td className="py-2.5 pr-3">{item.name}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{wh === "柔佛仓" ? "—" : item.warehouseA}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{wh === "吉隆坡仓" ? "—" : item.warehouseB}</td>
                  <td className="py-2.5 pr-3 tabular-nums font-medium">{total}</td>
                  <td className="py-2.5 pr-3 tabular-nums text-amber-600">{reserved > 0 ? reserved : "—"}</td>
                  <td className="py-2.5 pr-3 tabular-nums font-medium text-emerald-700">{available}</td>
                  <td className="py-2.5 pr-3">
                    {editingLocationSku === item.sku ? (
                      <input
                        autoFocus
                        value={locationDraft}
                        onChange={(e) => setLocationDraft(e.target.value)}
                        onBlur={() => saveLocation(item.sku)}
                        onKeyDown={(e) => e.key === "Enter" && saveLocation(item.sku)}
                        className="w-24 px-1.5 py-0.5 text-xs border border-slate-300 rounded outline-none focus:border-slate-500"
                      />
                    ) : (
                      <button
                        onClick={() => startEditLocation(item)}
                        className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
                      >
                        <MapPin size={11} /> {item.location || t("设置位置", "Set location")}
                      </button>
                    )}
                  </td>
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
                  <td className="py-2.5 pr-3">
                    <button
                      onClick={() => setMovementItem(item)}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                    >
                      <SlidersHorizontal size={11} /> {t("库存调整", "Adjust")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {movementItem && (
        <StockMovementForm
          t={t}
          item={movementItem}
          onCancel={() => setMovementItem(null)}
          onSave={async (values) => {
            const result = await onRecordMovement?.({ sku: movementItem.sku, ...values });
            if (!result?.error) setMovementItem(null);
            return result;
          }}
        />
      )}
    </div>
  );
}
