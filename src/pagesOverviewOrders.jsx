import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Search, X, ChevronRight, ChevronLeft, AlertTriangle, CheckCircle2, Truck, Circle,
  CheckCircle, Printer, Clock, Info, MapPin, PackagePlus, PackageMinus, SlidersHorizontal,
  Plus, Trash2, Warehouse as WarehouseIcon, ChevronDown,
  Package, CreditCard, ShoppingCart, RotateCcw, XCircle, PackageOpen, PackageCheck,
  ShoppingBag, Music2, Send, Zap,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from "recharts";
import {
  PLATFORM_THEME, SALES_TREND, STATUS_STEPS, ACTIONABLE_STATUS,
  profit, fmt, statusColor, statusLabel, warehouseLabel, supabaseClient,
  mapDbStockMovement, MOVEMENT_TYPE_LABELS, DEMO_TO_DB_PLATFORM,
} from "./shared.jsx";
// Reused from the Finance page's real settlement/estimate logic
// (2026-08-20, new) — OrderDrawer's new "预估收入明细"/"买家实付金额"
// sections read the exact same real Shopee data (order_settlements +
// incomeBreakdown/estimatedBreakdown), not a re-derived copy, so the
// numbers can never drift between the two pages. Pure reuse — none of
// pagesImportFinance.jsx's own logic changes because of this.
import { platformFeeRate, incomeBreakdown, estimatedBreakdown, FeeBreakdownPanel } from "./pagesImportFinance.jsx";

/* ============================== Overview ============================== */

// `platformBreakdown` (optional) = [{platform, count}] — when passed,
// renders the same Shopee/TikTok row style as the 订单总数 card below.
// Omitted by every other KPICard usage (库存预警/净利润), so they render
// exactly as before.
export function KPICard({ label, value, sub, icon: Icon, tone, onClick, platformBreakdown }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`glass-surface rounded-2xl p-4 flex items-center gap-3 card-3d w-full ${onClick ? "text-left" : ""}`}
    >
      <div className={`h-12 w-12 rounded-2xl flex items-center justify-center icon-badge-3d shrink-0 ${tone}`}>
        <Icon size={20} className="text-white" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-slate-500 mb-0.5 truncate">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-slate-400 mt-0.5 truncate">{sub}</div>}
        {platformBreakdown && (
          <div className="flex flex-col gap-1 mt-1.5">
            {platformBreakdown.map((p) => {
              const PfIcon = PLATFORM_ICON[p.platform];
              return (
                <span key={p.platform} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                  <PfIcon size={12} className={p.platform === "Shopee" ? "text-orange-500" : "text-rose-600"} />
                  {PLATFORM_SHORT_LABEL[p.platform]} <span className="font-semibold tabular-nums text-slate-600">{p.count}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
    </Tag>
  );
}

// Short display label for the dashboard only (per explicit request: show
// "TikTok" not "TikTok Shop" here) — every other page in the app keeps
// using the real "TikTok Shop" platform name unchanged, this is purely a
// local display string for the two new dashboard widgets below.
const PLATFORM_SHORT_LABEL = { Shopee: "Shopee", "TikTok Shop": "TikTok" };
const PLATFORM_ICON = { Shopee: ShoppingBag, "TikTok Shop": Music2 };

// Status breakdown donut colors — same families as statusColor() badges
// elsewhere (shared.jsx), just as hex fills for recharts instead of
// Tailwind classes. Purely cosmetic, not a new status taxonomy.
const STATUS_DONUT_COLORS = {
  待处理: "#f59e0b", 包装: "#6366f1", 出货: "#3b82f6", 物流中: "#06b6d4",
  已签收: "#10b981", 已取消: "#94a3b8", 退款中: "#f43f5e",
};

// date-range predicate shared by the KPI card's own click-through modal —
// operates on the same `o.date` (YYYY-MM-DD) field already used everywhere
// else in this file, no new data.
function inDateRange(dateStr, mode, customFrom, customTo) {
  if (!dateStr) return false;
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  if (mode === "today") return dateStr === todayStr;
  if (mode === "yesterday") {
    const y = new Date(today); y.setDate(y.getDate() - 1);
    return dateStr === y.toISOString().slice(0, 10);
  }
  if (mode === "7d") {
    const from = new Date(today); from.setDate(from.getDate() - 6);
    return dateStr >= from.toISOString().slice(0, 10) && dateStr <= todayStr;
  }
  if (mode === "30d") {
    const from = new Date(today); from.setDate(from.getDate() - 29);
    return dateStr >= from.toISOString().slice(0, 10) && dateStr <= todayStr;
  }
  if (mode === "custom") return (!customFrom || dateStr >= customFrom) && (!customTo || dateStr <= customTo);
  return true;
}

// "Pending order" for the 订单总数 KPI card and its popup — real pending
// orders only, same definition this file already uses for the "待处理订单"
// KPI card and the 平台订单总览 "待处理" column (o.status === "待处理" &&
// not UNPAID && not yet printed). Reusing the existing predicate, not a
// new business rule. This alone already excludes completed/shipped/in
// transit/cancelled orders (none of those are status "待处理"). Pure
// display-level filter over the same `orders` prop already loaded — no
// new fetch, no write, no change to order_status/platform_status anywhere
// else.
function isPendingOrder(o) {
  return o.status === "待处理" && o.platformStatus !== "UNPAID" && !(o.printCount > 0);
}

// 即时订单/Instant order.
// TikTok: matches only an exact "genuinely instant" delivery_option value —
// "Instant Delivery" / "Same-Day Delivery" / "Next-Day Delivery" (also kept:
// bare "Instant", TikTok's own docs label). Corrected 2026-08-17 (explicit
// user fix, reversing the same day's earlier change): "Next-day delivery"
// (lowercase d — TikTok's normal standard-speed shipping OPTION label, not
// an instant-order concept) was wrongly being matched, which silently
// pulled ordinary 待发货/待取货 orders into the 即时订单 card. Real TikTok
// Seller Centre currently has 0 genuine instant orders — verified live
// (`select delivery_option, count(*) from orders where platform='tiktok'
// and platform_status in ('AWAITING_SHIPMENT','AWAITING_COLLECTION') group
// by platform_status, delivery_option`: only "Next-day delivery"/"Standard
// shipping" exist right now, neither of which should count) — so this
// intentionally matches nothing in the current real dataset; it exists so a
// real future TikTok "Instant Delivery"/"Same-Day Delivery"/"Next-Day
// Delivery" order is still caught correctly without another code change.
// Shopee: unchanged, still matches via o.courier (its sync never populates
// delivery_option at all), e.g. "Instant Delivery (Arrange in 90 mins)" —
// confirmed live against 260815EDU42C32 / 260816ETGNQWFX / 260817HPPK7SF3.
// Additive OR throughout: neither platform's condition can ever match on
// the other's field (o.deliveryOption is always null for Shopee rows,
// o.courier never contains "instant" for real TikTok rows).
const TIKTOK_INSTANT_DELIVERY_OPTIONS = new Set(["Instant", "Instant Delivery", "Same-Day Delivery", "Next-Day Delivery"]);
function isInstantOrder(o) {
  return TIKTOK_INSTANT_DELIVERY_OPTIONS.has(o.deliveryOption) || (o.courier || "").toLowerCase().includes("instant");
}

// Single source of truth for which of the 3 Shipping Priority buckets
// (Overdue Not Shipped / Ship Today / Ship Before Tomorrow) an order falls
// into — used by both the card counts and the click-to-filter check, so a
// card's number and what clicking it shows can never drift apart. Uses the
// real platform deadline (`shipDeadline`) when the sync has captured it,
// falling back to the existing order-age estimate otherwise.
function getShipPriorityBucket(o, todayStr, yesterdayStr, tomorrowStr) {
  if (o.shipDeadline) {
    const deadlineDate = o.shipDeadline.slice(0, 10);
    if (deadlineDate < todayStr) return "overdue";
    if (deadlineDate === todayStr) return "shipToday";
    if (deadlineDate === tomorrowStr) return "shipByTomorrow";
    return null;
  }
  if (o.date < yesterdayStr) return "overdue";
  if (o.date === todayStr) return "shipToday";
  if (o.date === yesterdayStr) return "shipByTomorrow";
  return null;
}

const DATE_FILTER_OPTIONS = [
  { key: "today", zh: "今天", en: "Today" },
  { key: "yesterday", zh: "昨天", en: "Yesterday" },
  { key: "7d", zh: "最近7天", en: "Last 7 Days" },
  { key: "30d", zh: "最近30天", en: "Last 30 Days" },
  { key: "custom", zh: "自定义日期范围", en: "Custom Range" },
];

// Popup opened by clicking the 订单总数 KPI card. Read-only aggregation
// over the same `orders` prop Overview already has — no fetch, no writes.
// Level 1: today's real order count per platform (any status — NOT
// filtered to isPendingOrder; a past-dated order that's since shipped is
// still a real order for that date, and excluding it was the bug: date
// filters like "昨天" showed 0 even when the platform genuinely had orders
// that day, because those orders were no longer "待处理" by the time you
// looked). Clicking a platform drills into Level 2, a per-platform detail
// view where the date filter (今天/昨天/最近7天/最近30天/自定义) lives.
// `onSelectPlatform` notifies Overview so 平台订单总览 stays synced with
// whichever platform the user drilled into (requirement 4).
function OrderOverviewModal({ t, orders, onClose, onSelectPlatform }) {
  const [detailPlatform, setDetailPlatform] = useState(null); // null = level-1 list
  const [dateMode, setDateMode] = useState("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const todayStr = new Date().toISOString().slice(0, 10);
  const pendingByPlatform = ["Shopee", "TikTok Shop"].map((p) => ({
    platform: p,
    count: orders.filter((o) => o.platform === p && o.date === todayStr).length,
  }));

  const openDetail = (platform) => {
    setDetailPlatform(platform);
    setDateMode("today");
    onSelectPlatform(platform);
  };

  const detailCount = detailPlatform
    ? orders.filter((o) => o.platform === detailPlatform && inDateRange(o.date, dateMode, customFrom, customTo)).length
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="glass-surface rounded-2xl p-5 w-full max-w-sm card-3d" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1.5">
            {detailPlatform && (
              <button onClick={() => setDetailPlatform(null)} className="text-slate-400 hover:text-slate-600 -ml-1">
                <ChevronLeft size={16} />
              </button>
            )}
            {detailPlatform ? (
              <div className="flex items-center gap-1.5">
                {(() => { const Icon = PLATFORM_ICON[detailPlatform]; return (
                  <div className={`h-6 w-6 rounded-md flex items-center justify-center icon-badge-3d ${detailPlatform === "Shopee" ? "bg-gradient-to-br from-orange-400 to-orange-600" : "bg-gradient-to-br from-rose-500 to-rose-700"}`}>
                    <Icon size={13} className="text-white" />
                  </div>
                ); })()}
                <div className="text-sm font-semibold">{PLATFORM_SHORT_LABEL[detailPlatform]}</div>
              </div>
            ) : (
              <div className="text-sm font-semibold">{t("订单总览", "Order Overview")}</div>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>

        {!detailPlatform && (
          <div className="space-y-2">
            {pendingByPlatform.map((p) => {
              const Icon = PLATFORM_ICON[p.platform];
              return (
                <button
                  key={p.platform}
                  onClick={() => openDetail(p.platform)}
                  className="w-full flex items-center justify-between rounded-xl border border-slate-100 bg-white/60 px-3 py-2.5 hover:bg-white transition-3d text-left"
                >
                  <div className="flex items-center gap-2">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center icon-badge-3d ${p.platform === "Shopee" ? "bg-gradient-to-br from-orange-400 to-orange-600" : "bg-gradient-to-br from-rose-500 to-rose-700"}`}>
                      <Icon size={15} className="text-white" />
                    </div>
                    <span className="text-sm font-medium">{PLATFORM_SHORT_LABEL[p.platform]}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <div className="text-[10px] text-slate-400">{t("今日订单", "Today's Orders")}</div>
                      <div className="text-base font-semibold tabular-nums">{p.count}</div>
                    </div>
                    <ChevronRight size={14} className="text-slate-300" />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {detailPlatform && (
          <div>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {DATE_FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setDateMode(opt.key)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-3d ${
                    dateMode === opt.key ? "bg-violet-600 text-white border-violet-600" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {t(opt.zh, opt.en)}
                </button>
              ))}
            </div>
            {dateMode === "custom" && (
              <div className="flex items-center gap-2 mb-4 text-xs">
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="input-3d border border-slate-200 rounded-lg px-2 py-1.5 outline-none flex-1" />
                <span className="text-slate-400">–</span>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="input-3d border border-slate-200 rounded-lg px-2 py-1.5 outline-none flex-1" />
              </div>
            )}
            <div className="rounded-xl border border-slate-100 bg-white/60 px-4 py-4 text-center">
              <div className="text-xs text-slate-400 mb-1">{t("订单数量", "Orders")}</div>
              <div className="text-3xl font-semibold tabular-nums">{detailCount}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Popup opened by the "待处理订单" KPI card — pick a platform, then jump to
// 订单管理中心 → 待发货 (To Ship), pre-filtered to that platform. No new
// page: reuses the existing Orders component via `entryFilter` (see Orders
// above). `platformCounts` = pendingByPlatformKPI, already computed in
// Overview from the same real `orders` prop — no new data source.
function PendingPlatformModal({ t, onClose, onSelectPlatform, platformCounts }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="glass-surface rounded-2xl p-5 w-full max-w-sm card-3d" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-semibold">{t("选择平台", "Select Platform")}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
        <div className="space-y-2">
          {platformCounts.map((p) => {
            const Icon = PLATFORM_ICON[p.platform];
            return (
              <button
                key={p.platform}
                onClick={() => onSelectPlatform(p.platform)}
                className="w-full flex items-center gap-3 rounded-xl border border-slate-100 bg-white/60 px-3 py-3 hover:bg-white transition-3d text-left"
              >
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center icon-badge-3d shrink-0 ${p.platform === "Shopee" ? "bg-gradient-to-br from-orange-400 to-orange-600" : "bg-gradient-to-br from-rose-500 to-rose-700"}`}>
                  <Icon size={16} className="text-white" />
                </div>
                <span className="text-sm font-medium flex-1">{PLATFORM_SHORT_LABEL[p.platform]}</span>
                <span className="text-sm font-semibold tabular-nums text-slate-600">{p.count}</span>
                <ChevronRight size={14} className="text-slate-300" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Overview({ t, orders, inventory, stores, onOpenOrder, goTo, onGoToOrdersToShip }) {
  const pending = orders.filter((o) => o.status === "待处理" && o.platformStatus !== "UNPAID" && !(o.printCount > 0)).length;
  const totalProfit = orders.filter((o) => o.status !== "已取消").reduce((s, o) => s + profit(o), 0);
  const lowStock = inventory.filter((i) => i.warehouseA + i.warehouseB < i.reorderPoint);
  const recent = orders.slice(0, 6);
  const manualStores = stores.filter((s) => s.syncMode === "manual");
  const lang = t("zh", "en");
  const [showOrderOverview, setShowOrderOverview] = useState(false);
  const [showPendingPopup, setShowPendingPopup] = useState(false);
  const [storeFilter, setStoreFilter] = useState("all"); // "all" | "Shopee" | "TikTok Shop" | store id

  // 订单总数 card — today's PENDING orders only (Shopee + TikTok combined),
  // same isPendingOrder definition used by the 待处理订单 card below, just
  // additionally scoped to today's date. Same `orders` prop, no new data
  // source, no new fetch.
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayOrders = orders.filter((o) => o.date === todayStr && isPendingOrder(o));
  const todayTotal = todayOrders.length;
  const todayByPlatformKPI = ["Shopee", "TikTok Shop"].map((p) => ({
    platform: p,
    count: todayOrders.filter((o) => o.platform === p).length,
  }));

  // 待处理订单 card — real pending orders (isPendingOrder, same definition
  // used elsewhere in this file), split per platform.
  const pendingByPlatformKPI = ["Shopee", "TikTok Shop"].map((p) => ({
    platform: p,
    count: orders.filter((o) => o.platform === p && isPendingOrder(o)).length,
  }));

  // 平台订单总览 / 订单状态分布 — both pure display aggregations over the
  // same `orders`/`stores` props the KPI cards above already read, no new
  // data source, no new fetch, no state mutation. Row shape follows the
  // requested columns (Platform / Store count / Orders / Sales amount /
  // Pending orders), grouped per platform by default and drillable down to
  // a single real store via the filter — currently 1 connected store per
  // platform in this system (not fabricated placeholder "Store A/B/C"
  // stores), so "Store count" reads 1 for both until more are connected.
  const pendingPredicate = isPendingOrder;
  const isSpecificStore = storeFilter !== "all" && storeFilter !== "Shopee" && storeFilter !== "TikTok Shop";
  const platformOverview = isSpecificStore
    ? stores.filter((s) => s.id === storeFilter).map((s) => {
        const storeOrders = orders.filter((o) => o.platformAccountId === s.id);
        return {
          key: s.id, platform: s.platform, storeCount: 1,
          orderCount: storeOrders.length,
          sales: storeOrders.reduce((sum, o) => sum + o.unitPrice * o.qty, 0),
          pendingCount: storeOrders.filter(pendingPredicate).length,
        };
      })
    : ["Shopee", "TikTok Shop"]
        .filter((p) => storeFilter === "all" || storeFilter === p)
        .map((p) => {
          const platformStores = stores.filter((s) => s.platform === p);
          const platformOrders = orders.filter((o) => o.platform === p);
          return {
            key: p, platform: p, storeCount: platformStores.length,
            orderCount: platformOrders.length,
            sales: platformOrders.reduce((sum, o) => sum + o.unitPrice * o.qty, 0),
            pendingCount: platformOrders.filter(pendingPredicate).length,
          };
        });
  const statusBreakdown = Object.entries(
    orders.reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc; }, {}),
  ).map(([status, count]) => ({ status, count, color: STATUS_DONUT_COLORS[status] || "#cbd5e1" }));

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
        <button type="button" onClick={() => setShowOrderOverview(true)} className="glass-surface rounded-2xl p-4 flex items-center gap-3 card-3d text-left">
          <div className="h-12 w-12 rounded-2xl flex items-center justify-center icon-badge-3d shrink-0 bg-gradient-to-br from-teal-400 to-teal-600">
            <CheckCircle2 size={20} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-slate-500 mb-0.5 truncate">{t("订单总数", "Total Orders")}</div>
            <div className="text-2xl font-semibold tabular-nums">{todayTotal}</div>
            <div className="text-xs text-slate-400 mt-0.5">{t("今日待处理订单", "Today's Pending Orders")}</div>
            <div className="flex flex-col gap-1 mt-1.5">
              {todayByPlatformKPI.map((p) => {
                const Icon = PLATFORM_ICON[p.platform];
                return (
                  <span key={p.platform} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                    <Icon size={12} className={p.platform === "Shopee" ? "text-orange-500" : "text-rose-600"} />
                    {PLATFORM_SHORT_LABEL[p.platform]} <span className="font-semibold tabular-nums text-slate-600">{p.count}</span>
                  </span>
                );
              })}
            </div>
          </div>
        </button>
        <KPICard label={t("待处理订单", "Pending Orders")} value={pending} sub={t("需要拣货/发货", "Needs picking/shipping")} icon={AlertTriangle} tone="bg-gradient-to-br from-amber-400 to-amber-600" onClick={() => setShowPendingPopup(true)} platformBreakdown={pendingByPlatformKPI} />
        <KPICard label={t("库存预警 SKU", "Low Stock SKUs")} value={lowStock.length} sub={t("低于安全库存", "Below safety stock")} icon={AlertTriangle} tone="bg-gradient-to-br from-rose-400 to-rose-600" />
        <KPICard label={t("净利润 (RM)", "Net Profit (RM)")} value={fmt(totalProfit)} sub={t("已扣除平台费/佣金", "After platform fees/commission")} icon={CheckCircle2} tone="bg-gradient-to-br from-indigo-400 to-indigo-600" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-white border border-slate-100 rounded-2xl p-4 card-3d">
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

        <div className="bg-white border border-slate-100 rounded-2xl p-4 card-3d">
          <div className="text-sm font-medium mb-3">{t("库存预警", "Stock Alerts")}</div>
          <div className="space-y-2">
            {lowStock.slice(0, 5).map((item) => (
              <div key={item.sku} className="flex items-center justify-between text-sm border-b border-slate-100 pb-2 last:border-0 row-3d rounded-lg px-2 -mx-2">
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-surface rounded-2xl p-4 card-3d">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="text-sm font-medium">{t("平台订单总览", "Platform Order Overview")}</div>
            <select
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
              className="input-3d text-xs border border-slate-200 rounded-lg px-2 py-1 outline-none"
            >
              <option value="all">{t("全部平台", "All Platforms")}</option>
              <option value="Shopee">Shopee</option>
              <option value="TikTok Shop">TikTok</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[420px]">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-200">
                  <th className="py-1.5 pr-2 font-medium">{t("平台", "Platform")}</th>
                  <th className="py-1.5 pr-2 font-medium text-right">{t("店铺数", "Stores")}</th>
                  <th className="py-1.5 pr-2 font-medium text-right">{t("订单数", "Orders")}</th>
                  <th className="py-1.5 pr-2 font-medium text-right">{t("销售额 (RM)", "Sales (RM)")}</th>
                  <th className="py-1.5 pr-2 font-medium text-right">{t("待处理", "Pending")}</th>
                </tr>
              </thead>
              <tbody>
                {platformOverview.map((p) => (
                  <tr key={p.key} className="border-b border-slate-100 last:border-0 row-3d">
                    <td className="py-2 pr-2 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${PLATFORM_THEME[p.platform].dot}`} />
                        {PLATFORM_SHORT_LABEL[p.platform]}
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums text-slate-500">{p.storeCount}</td>
                    <td className="py-2 pr-2 text-right tabular-nums font-medium">{p.orderCount}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-slate-700">{fmt(p.sales)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-amber-600">{p.pendingCount}</td>
                  </tr>
                ))}
                {platformOverview.length === 0 && (
                  <tr><td colSpan={5} className="py-3 text-center text-slate-400">{t("无数据", "No data")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass-surface rounded-2xl p-4 card-3d">
          <div className="text-sm font-medium mb-3">{t("订单状态分布", "Order Status Distribution")}</div>
          <div className="flex items-center gap-4">
            <div className="relative h-32 w-32 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusBreakdown} dataKey="count" nameKey="status" innerRadius={38} outerRadius={58} paddingAngle={2}>
                    {statusBreakdown.map((s) => <Cell key={s.status} fill={s.color} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="text-[10px] text-slate-400">{t("总订单", "Total")}</div>
                <div className="text-base font-semibold tabular-nums">{orders.length}</div>
              </div>
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
              {statusBreakdown.map((s) => (
                <div key={s.status} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-slate-600 truncate">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    {statusLabel(s.status, lang)}
                  </span>
                  <span className="tabular-nums text-slate-500 shrink-0 ml-2">
                    {s.count} ({orders.length > 0 ? ((s.count / orders.length) * 100).toFixed(1) : "0.0"}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl p-4 card-3d">
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
              <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 row-3d">
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

      {showOrderOverview && (
        <OrderOverviewModal
          t={t}
          orders={orders}
          onClose={() => setShowOrderOverview(false)}
          onSelectPlatform={(platform) => setStoreFilter(platform)}
        />
      )}

      {showPendingPopup && (
        <PendingPlatformModal
          t={t}
          platformCounts={pendingByPlatformKPI}
          onClose={() => setShowPendingPopup(false)}
          onSelectPlatform={(platform) => {
            setShowPendingPopup(false);
            if (onGoToOrdersToShip) onGoToOrdersToShip(platform);
          }}
        />
      )}
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
  toShip: { zh: "待发货", en: "To Ship" }, // = real platformStatus === "AWAITING_SHIPMENT" (2026-08-03: switched off print_count — TikTok's own status doesn't distinguish "printed" from "not printed", both are AWAITING_SHIPMENT, so splitting on print_count was an ERP-invented distinction that drifted from the platform's real count)
  toPickup: { zh: "待取货", en: "To Pickup" }, // = real platformStatus === "AWAITING_COLLECTION" (2026-08-03: this value has never appeared in synced TikTok data — Seller Center's "Awaiting collection" isn't exposed by the order search API this ERP syncs from — so this card is expected to read 0 until/unless TikTok starts returning it, which matches Seller Center's own count) OR "PROCESSED" (2026-08-17, authorized: Shopee's real post-ship_order status, written by shopee-push-fulfillment immediately on success — additive, does not affect TikTok)
  inTransit: { zh: "运输中", en: "In Transit" }, // = real platformStatus === "IN_TRANSIT" (2026-07-29: was the dead o.status==="物流中")
  delivered: { zh: "已送达", en: "Delivered" }, // = real platformStatus === "DELIVERED" only (2026-08-05: dropped COMPLETED — verified live against TikTok's own API total_count per status: DELIVERED=408, COMPLETED=5653, these are two distinct Seller Center buckets, not one; COMPLETED orders still show under 全部, just no longer inflate this card)
  completed: { zh: "已完成", en: "Completed" }, // = real platformStatus === "COMPLETED" — identical definition on both platforms (2026-08-17, new combo-card bottom half, paired with 已送达)
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
  { key: "all", ...ORDER_STATUS_LABELS.all, filterValue: "全部", iconBg: "bg-gradient-to-br from-amber-400 to-amber-600", iconColor: "text-white", numberColor: "text-amber-600", icon: Package, match: () => true },
  { key: "toShip", ...ORDER_STATUS_LABELS.toShip, filterValue: "__to_ship__", iconBg: "bg-gradient-to-br from-red-400 to-red-600", iconColor: "text-white", numberColor: "text-red-600", icon: PackagePlus, match: (o) => o.platformStatus === "AWAITING_SHIPMENT" },
  { key: "toPickup", ...ORDER_STATUS_LABELS.toPickup, filterValue: "__to_pickup__", iconBg: "bg-gradient-to-br from-blue-400 to-blue-600", iconColor: "text-white", numberColor: "text-blue-600", icon: ShoppingCart, match: (o) => o.platformStatus === "AWAITING_COLLECTION" || o.platformStatus === "PROCESSED" },
  { key: "inTransit", ...ORDER_STATUS_LABELS.inTransit, filterValue: "__in_transit__", iconBg: "bg-gradient-to-br from-purple-400 to-purple-600", iconColor: "text-white", numberColor: "text-purple-600", icon: Truck, match: (o) => o.platformStatus === "IN_TRANSIT" || o.platformStatus === "SHIPPED" },
  // Shopee real data confirmed live (2026-08-17): 0 rows ever use DELIVERED,
  // 612 real rows use COMPLETED — Shopee has no separate "delivered but not
  // completed" bucket the way TikTok does, so COMPLETED is Shopee's actual
  // terminal delivered state. Gated on o.platform (per-row, not a component
  // closure) so TikTok's own DELIVERED-only definition — and its deliberate
  // DELIVERED-vs-COMPLETED distinction (see cardCounts below) — is untouched.
  // TO_CONFIRM_RECEIVE added 2026-08-17 (explicit user classification,
  // Shopee-only): real data shows these are already-shipped orders awaiting
  // buyer receipt confirmation (courier already assigned, e.g. SPX Express /
  // Instant Delivery), not pre-shipment — so it belongs here, not in
  // 待取货. Confirmed it never overlaps 待取货's own AWAITING_COLLECTION/
  // PROCESSED match above.
  { key: "delivered", ...ORDER_STATUS_LABELS.delivered, filterValue: "__delivered__", iconBg: "bg-gradient-to-br from-green-400 to-green-600", iconColor: "text-white", numberColor: "text-green-600", icon: CheckCircle, match: (o) => o.platformStatus === "DELIVERED" || (o.platform === "Shopee" && (o.platformStatus === "COMPLETED" || o.platformStatus === "TO_CONFIRM_RECEIVE")) },
];

// 8th grid slot: 投递失败 (top, gray, no filterValue — never highlights) +
// 已取消 (bottom, orange, filterValue "已取消" — highlights the whole shared
// outer border, same as any other card, when that chip is selected).
const FAILED_CANCELLED_SPLIT_CARD = {
  top: { ...ORDER_STATUS_LABELS.failed, iconBg: "bg-gradient-to-br from-slate-300 to-slate-500", iconColor: "text-white", numberColor: "text-slate-500", icon: AlertTriangle, match: (o) => o.platformStatus === "FAILED_DELIVERY" || o.platformStatus === "UNDELIVERED" },
  bottom: { ...ORDER_STATUS_LABELS.cancelled, filterValue: "已取消", iconBg: "bg-gradient-to-br from-orange-400 to-orange-600", iconColor: "text-white", numberColor: "text-orange-600", icon: XCircle, match: (o) => o.orderStatus === "cancelled" },
};

// Merged into one shared card frame (2026-08-05, UI-only): 未付款 (top, no
// filterValue — was never clickable, unchanged) + 退货/退款 (bottom,
// filterValue "退款中", was already clickable) — same layout pattern as
// FAILED_CANCELLED_SPLIT_CARD above, same underlying cardCounts/match, just
// grouped into one box instead of two separate grid cells.
const UNPAID_RETURNED_SPLIT_CARD = {
  top: { ...ORDER_STATUS_LABELS.unpaid, iconBg: "bg-gradient-to-br from-pink-400 to-pink-600", iconColor: "text-white", numberColor: "text-pink-600", icon: CreditCard, match: (o) => o.platformStatus === "UNPAID" },
  bottom: { ...ORDER_STATUS_LABELS.returned, filterValue: "退款中", iconBg: "bg-gradient-to-br from-rose-400 to-rose-600", iconColor: "text-white", numberColor: "text-rose-600", icon: RotateCcw, match: (o) => o.orderStatus === "returned" },
};

// 已送达 (top) + 已完成 (bottom) merged into one two-tier card (2026-08-17,
// explicit UI restructure request, applies to both Shopee and TikTok).
// Same shared-frame pattern as the two split cards above, but deliberately
// carries no `numberColor`/count on either half — per explicit request this
// card never shows a number at all; the real total only appears on the
// dedicated page once you click through (see the banner above the order
// list, and the `filtered` __delivered__/__completed__ branches). 已送达
// reuses the exact same filterValue/match the old standalone card used
// (untouched: TikTok stays DELIVERED-only, Shopee also matches
// COMPLETED/TO_CONFIRM_RECEIVE). 已完成 is new: real platformStatus ===
// "COMPLETED", identical definition on both platforms — this is TikTok's
// own distinct terminal status already established elsewhere in this file
// as separate from DELIVERED, not a redefinition of anything.
const DELIVERED_COMPLETED_SPLIT_CARD = {
  top: { ...ORDER_STATUS_LABELS.delivered, filterValue: "__delivered__", iconBg: "bg-gradient-to-br from-green-400 to-green-600", iconColor: "text-white", icon: CheckCircle, match: (o) => o.platformStatus === "DELIVERED" || (o.platform === "Shopee" && (o.platformStatus === "COMPLETED" || o.platformStatus === "TO_CONFIRM_RECEIVE")) },
  bottom: { ...ORDER_STATUS_LABELS.completed, filterValue: "__completed__", iconBg: "bg-gradient-to-br from-emerald-400 to-emerald-600", iconColor: "text-white", icon: PackageCheck, match: (o) => o.platformStatus === "COMPLETED" },
};

/* ============================== Orders (订单列表) ============================== */

const NOTE_COLORS = { red: "#ef4444", yellow: "#eab308", purple: "#a855f7" };

export function Orders({ t, orders, stores, onOpenOrder, onPrint, onConfirmProcess, onUpdateStatus, onUpdateNote, onMarkPicked, onMarkPacked, goTo, entryFilter, onConsumeEntryFilter }) {
  // entryFilter (optional) = { platform, status } passed in from the
  // Dashboard's "待处理订单" card popup — pre-selects platform + status on
  // first mount only, then is consumed/cleared so a normal sidebar visit to
  // this page still defaults to Shopee/全部 as before. Orders unmounts on
  // tab switch (conditionally rendered in erp-mvp-demo.jsx), so a plain
  // lazy useState initializer is enough — no extra effect needed to re-sync.
  const [activePlatform, setActivePlatform] = useState(() => entryFilter?.platform || "Shopee");
  const [activeStore, setActiveStore] = useState(null); // null = 该平台全部店铺
  const [statusFilter, setStatusFilter] = useState(() => entryFilter?.status || "全部");
  // Click filter for the 3 Shipping Priority cards (Ship Today / Ship
  // Before Tomorrow / Overdue Not Shipped) — only meaningful while
  // statusFilter === "__to_ship__" (see `filtered` below, same gate the
  // cards themselves are rendered under).
  const [priorityFilter, setPriorityFilter] = useState(null);
  // 即时订单 dedicated page (2026-08-17, Shopee only) — "pending" | "processed",
  // only meaningful while statusFilter === "__instant_orders__" (see
  // `filtered` below). Replaces the old instantFilter toggle that used to
  // narrow 待发货 itself; instant orders no longer appear under 待发货 at
  // all now, they have this separate page instead.
  const [instantStage, setInstantStage] = useState("pending");
  useEffect(() => {
    if (entryFilter && onConsumeEntryFilter) onConsumeEntryFilter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Status-card counts, fetched independently of the (capped) `orders` prop
  // via `{count:"exact",head:true}` queries — zero row data transferred,
  // just numbers — so cards reflect the true full-table count even though
  // `orders` itself (loaded once in erp-mvp-demo.jsx, unchanged by this)
  // only holds the most recent 5000 rows. Re-fetched on platform/store
  // switch only, not on every render. Falls back to counting the in-memory
  // `all` array (old behavior) while a platform's counts haven't loaded yet.
  const [cardCounts, setCardCounts] = useState({});
  const [q, setQ] = useState("");
  const [searchField, setSearchField] = useState("orderNo");
  const [dateFilter, setDateFilter] = useState("");
  const [dateMode, setDateMode] = useState("all"); // "all" | "today" | "7d" | "30d" | "custom"
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [noteEditingId, setNoteEditingId] = useState(null);
  const [noteDraftText, setNoteDraftText] = useState("");
  const [noteDraftColor, setNoteDraftColor] = useState(null);
  // Screen coordinates for the note popup, computed when it opens — see the
  // trigger button below. Display-only fix for a real bug: the popup used
  // to be `position: absolute` inside the scrollable order list, so for any
  // row near the bottom of the visible scroll area, its Save button was
  // clipped by the list's own scroll boundary. `position: fixed` at
  // measured, viewport-clamped coordinates escapes that clipping entirely,
  // regardless of scroll position. Doesn't touch noteDraftText/
  // noteDraftColor/onUpdateNote or note_color/note_text — purely where the
  // popup renders on screen.
  const [notePopupPos, setNotePopupPos] = useState(null);
  // "确认发货" batch-bar button — TikTok-only, 待发货 view only (see the
  // activePlatform/statusFilter gates on 拣货完成/包装完成 below, which stay
  // untouched for Shopee and every other view). Reuses the exact same
  // onMarkPicked/onMarkPacked handlers and the exact same
  // tiktok-ship-package-test Edge Function calls already validated
  // standalone — no backend/API/lookup/sync changes, only this entry point.
  const [shipConfirmOpen, setShipConfirmOpen] = useState(false);
  const [shipBatchStatus, setShipBatchStatus] = useState("idle"); // idle|loading|done
  // Shopee's own "确认发货" — separate state, separate handler, separate
  // modal from TikTok's above (2026-08-11). Does NOT call onMarkPicked/
  // onMarkPacked and does NOT touch warehouse_stage — shopee-push-fulfillment
  // gates on the real Shopee platform_status instead, so no ERP-internal
  // pick/pack workflow is required for Shopee, unlike TikTok's button.
  const [shopeeShipConfirmOpen, setShopeeShipConfirmOpen] = useState(false);
  const [shopeeShipBatchStatus, setShopeeShipBatchStatus] = useState("idle");

  // targetOrders passed in from the button's onClick closure. Sequence per
  // order: pick -> pack (both no-ops if already done, per their own
  // existing warehouse_stage gating) -> lookup -> ship -> batch-print
  // whichever succeeded, once, at the end.
  async function runShipBatch(targetOrders) {
    setShipConfirmOpen(false);
    setShipBatchStatus("loading");
    const shipped = [];
    for (const order of targetOrders) {
      await onMarkPicked([order.id]);
      await onMarkPacked([order.id]);
      const { data: lookup, error: lookupErr } = await supabaseClient.functions.invoke("tiktok-ship-package-test", { body: { action: "lookup", orderNo: order.id } });
      if (lookupErr || !lookup?.found || !lookup.packageId) continue;
      const { data: shipResult, error: shipErr } = await supabaseClient.functions.invoke("tiktok-ship-package-test", {
        body: {
          action: "ship",
          orderNo: order.id,
          packageId: lookup.packageId,
          shippingProviderId: lookup.shippingProviderId,
          // Auto-generated: TikTok-managed-logistics orders (shipping_type
          // "TIKTOK") — the already-tested Ship Package call has succeeded
          // with a placeholder value every time, no manual input needed.
          trackingNumber: `AUTO-${order.id}-${Date.now()}`,
        },
      });
      if (!shipErr && shipResult?.success) shipped.push(order);
    }
    setShipBatchStatus("done");
    if (shipped.length > 0) onPrint(shipped);
  }

  // Shopee equivalent of runShipBatch above — calls only the already-deployed
  // shopee-push-fulfillment function (get_shipping_parameter + ship_order
  // internally), no onMarkPicked/onMarkPacked, no warehouse_stage write. The
  // order's departure from 待发货 happens via the existing shopee-sync-orders
  // cron picking up the real post-ship status on its next pass, same as
  // TikTok already relies on for its own eventual status change.
  async function runShopeeShipBatch(targetOrders) {
    setShopeeShipConfirmOpen(false);
    setShopeeShipBatchStatus("loading");
    const shipped = [];
    for (const order of targetOrders) {
      const { data, error } = await supabaseClient.functions.invoke("shopee-push-fulfillment", { body: { orderId: order.id } });
      if (!error && data?.success) shipped.push(order);
    }
    setShopeeShipBatchStatus("done");
    if (shipped.length > 0) onPrint(shipped);
  }
  // Hides 拣货完成/包装完成 only where they're guaranteed to have zero effect:
  // TikTok's 待发货 (replaced by "确认发货", which already calls
  // onMarkPicked+onMarkPacked itself) and 运输中/已送达/已取消 — those three
  // are excluded from `actionableOrders` (below, same filter both buttons
  // use) by platformStatus/status, so the buttons can never act on anything
  // there regardless of data state. Kept everywhere else (全部/待取货/退款/
  // Shopee's own 待发货): 全部 is the primary place pick/pack normally
  // happens, and 待取货/退款 can legitimately hold orders shipped outside
  // ERP whose warehouse_stage was never advanced — hiding there would
  // remove real function.
  // TikTok's 即时订单/待处理 stage (2026-08-17) is the same real
  // AWAITING_SHIPMENT status as 待发货, just pre-filtered to instant orders,
  // so it gets the same treatment: "确认发货" (below, not gated by
  // statusFilter) already calls onMarkPicked+onMarkPacked itself.
  const hidePickPack = (activePlatform === "TikTok Shop" && statusFilter === "__to_ship__")
    || (activePlatform === "TikTok Shop" && statusFilter === "__instant_orders__" && instantStage === "pending")
    || statusFilter === "__in_transit__" || statusFilter === "__delivered__" || statusFilter === "__completed__" || statusFilter === "已取消";
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
    { ...ORDER_STATUS_LABELS.toShip, filterValue: "__to_ship__" },
    { ...ORDER_STATUS_LABELS.toPickup, filterValue: "__to_pickup__" },
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

  const platformStores = stores.filter((s) => s.platform === activePlatform);
  const allManual = platformStores.length > 0 && platformStores.every((s) => s.syncMode === "manual");

  // platformStores is already hidden-filtered upstream (loadRealData only
  // fetches platform_accounts where hidden=false) — orders belonging to a
  // hidden store's platform_account_id are real orders, just orphaned from
  // "全部店铺"'s count once their store is hidden, so exclude them here too
  // instead of only when a specific (necessarily-visible) store is picked.
  const visibleAccountIds = useMemo(() => new Set(platformStores.map((s) => s.id)), [platformStores]);

  const all = useMemo(
    () => orders.filter((o) => o.platform === activePlatform && visibleAccountIds.has(o.platformAccountId) && (!activeStore || o.platformAccountId === activeStore)),
    [orders, activePlatform, activeStore, visibleAccountIds],
  );

  useEffect(() => {
    let cancelled = false;
    const dbPlatform = DEMO_TO_DB_PLATFORM[activePlatform];
    if (!dbPlatform) return;
    function base() {
      let q = supabaseClient.from("orders").select("id", { count: "exact", head: true }).eq("platform", dbPlatform);
      // 全部店铺 (activeStore null) must still exclude hidden stores' orders
      // — same gap as the earlier "25 vs 24" fix, just in this separate
      // live-count query instead of the in-memory `all` list (that fix never
      // touched this query, so a hidden store's order could still leak into
      // this card's number even though the visible order LIST already
      // excluded it). A specific activeStore is always already a visible
      // store (picked from the hidden-filtered `stores` prop), so this only
      // changes behavior for the "全部店铺" (null) case.
      if (activeStore) q = q.eq("platform_account_id", activeStore);
      else q = q.in("platform_account_id", Array.from(visibleAccountIds));
      return q;
    }
    // 即时订单 (instant) has its own card/page for both platforms now
    // (Shopee: 2026-08-17; TikTok: 2026-08-17 same day, added second) — so
    // 待发货/待取货 must exclude them here — otherwise an instant order
    // would double-count under both cards. Each platform identifies
    // "instant" via its own real synced field: Shopee via o.courier (its
    // sync never populates delivery_option), TikTok via o.delivery_option —
    // must stay in exact lockstep with TIKTOK_INSTANT_DELIVERY_OPTIONS /
    // isInstantOrder above (2026-08-17 correction: "Next-day delivery" is a
    // normal shipping speed option, not an instant order, and was wrongly
    // matching here too). Gated per-platform so neither platform's query
    // construction is touched by the other's rule.
    const isShopee = activePlatform === "Shopee";
    const isTikTok = activePlatform === "TikTok Shop";
    const tiktokInstantOptions = Array.from(TIKTOK_INSTANT_DELIVERY_OPTIONS);
    function excludeInstant(q) {
      if (isShopee) return q.not("courier", "ilike", "%instant%");
      // Chained .not(eq) per value rather than a single .not(..., "in", ...)
      // — avoids PostgREST's quoted-list string formatting entirely (values
      // here contain spaces/hyphens), same safe pattern as the rest of this
      // file's platform_status filters.
      if (isTikTok) return tiktokInstantOptions.reduce((acc, opt) => acc.not("delivery_option", "eq", opt), q);
      return q;
    }
    function onlyInstant(q) {
      if (isTikTok) return q.in("delivery_option", tiktokInstantOptions);
      return q.ilike("courier", "%instant%");
    }
    Promise.all([
      base(),
      base().eq("platform_status", "UNPAID"),
      // TikTok's AWAITING_SHIPMENT unchanged; READY_TO_SHIP added additively
      // for Shopee (2026-08-11) — never appears on real TikTok rows, so this
      // is a no-op for TikTok's actual count. Instant orders excluded for
      // Shopee (2026-08-17) — they have their own card now.
      excludeInstant(base().in("platform_status", ["AWAITING_SHIPMENT", "READY_TO_SHIP"])),
      // TikTok's AWAITING_COLLECTION unchanged; PROCESSED added additively
      // for Shopee (2026-08-17) — real post-ship_order status, never
      // appears on real TikTok rows, so this is a no-op for TikTok's count.
      // Instant orders excluded for Shopee — same reasoning as toShip above.
      excludeInstant(base().in("platform_status", ["AWAITING_COLLECTION", "PROCESSED"])),
      // TikTok's IN_TRANSIT unchanged; SHIPPED added additively for Shopee
      // (2026-08-17) — Shopee's real post-ship_order-and-picked-up status
      // (confirmed live: 42 real SHIPPED rows on the visible store, 0 rows
      // ever use IN_TRANSIT for Shopee), never appears on real TikTok rows,
      // so this is a no-op for TikTok's count. This was the actual bug
      // behind "运输中 empty for a specific Shopee store" — it was always
      // empty for Shopee at any scope (全部店铺 included), not a per-store
      // filtering bug; SHIPPED just wasn't counted as 运输中 anywhere yet.
      base().in("platform_status", ["IN_TRANSIT", "SHIPPED"]),
      // 已送达: TikTok stays DELIVERED-only — verified live against TikTok's
      // own API total_count per status (DELIVERED=408, COMPLETED=5653):
      // these are two distinct Seller Center buckets, not one. COMPLETED
      // orders aren't dropped, they just don't inflate this card for
      // TikTok. Shopee (2026-08-17, isShopee-gated) adds COMPLETED — Shopee
      // real data confirmed live: 0 rows ever use DELIVERED, 612 real rows
      // use COMPLETED, so COMPLETED is Shopee's actual terminal "delivered"
      // status, not a separate later stage the way it is for TikTok. This
      // was the real bug behind "已送达 empty for a specific Shopee store" —
      // it was always empty for Shopee at any scope, not a per-store filter
      // bug; DELIVERED alone just never matches any real Shopee order.
      // TO_CONFIRM_RECEIVE added 2026-08-17 (explicit user classification) —
      // real rows in this status are already shipped (courier assigned),
      // just awaiting buyer receipt confirmation, so it belongs in 已送达
      // not 待取货 (待取货's own query above is unchanged, only
      // AWAITING_COLLECTION/PROCESSED).
      isShopee ? base().in("platform_status", ["DELIVERED", "COMPLETED", "TO_CONFIRM_RECEIVE"]) : base().eq("platform_status", "DELIVERED"),
      base().eq("order_status", "returned"),
      base().eq("platform_status", "FAILED_DELIVERY"),
      base().eq("platform_status", "UNDELIVERED"),
      base().eq("order_status", "cancelled"),
      // 今天取消: no dedicated "cancelled_at" column exists (not adding one
      // per explicit instruction), so this uses the existing `updated_at`
      // as the closest available signal — the moment ERP's own sync last
      // wrote this row, which for a cancelled order is effectively when ERP
      // recorded the cancellation.
      base().eq("order_status", "cancelled").gte("updated_at", `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
      // 即时订单 two-stage counts — Shopee card (2026-08-17) via onlyInstant's
      // courier match, TikTok card (2026-08-17, same pattern) via
      // onlyInstant's delivery_option match. AWAITING_SHIPMENT/READY_TO_SHIP
      // = To Process (待发货/待处理), AWAITING_COLLECTION/PROCESSED =
      // Processed (待取货/已处理) — same real status pair each platform's
      // own regular toShip/toPickup cards already use, just narrowed to
      // instant-only rows.
      onlyInstant(base().in("platform_status", ["AWAITING_SHIPMENT", "READY_TO_SHIP"])),
      onlyInstant(base().in("platform_status", ["AWAITING_COLLECTION", "PROCESSED"])),
      // 已完成 (2026-08-17, new combo-card bottom half) — real
      // platform_status === "COMPLETED", scoped to the current
      // platform/store the same way every other count above already is
      // (base() already handles activeStore/hidden-store exclusion). Same
      // real value the top-of-page cross-platform "已完成订单" KPI card
      // uses, just filtered down to one platform/store here instead of
      // summing both at once.
      base().eq("platform_status", "COMPLETED"),
    ]).then(([all_, unpaid, toShip, toPickup, inTransit, delivered, returned, failedA, failedB, cancelled_, cancelledToday, instantToProcess, instantProcessed, completed]) => {
      if (cancelled) return;
      setCardCounts({
        all: all_.count ?? 0,
        unpaid: unpaid.count ?? 0,
        toShip: toShip.count ?? 0,
        toPickup: toPickup.count ?? 0,
        inTransit: inTransit.count ?? 0,
        delivered: delivered.count ?? 0,
        returned: returned.count ?? 0,
        failed: (failedA.count ?? 0) + (failedB.count ?? 0),
        cancelled: cancelled_.count ?? 0,
        cancelledToday: cancelledToday.count ?? 0,
        instantToProcess: instantToProcess.count ?? 0,
        instantProcessed: instantProcessed.count ?? 0,
        completed: completed.count ?? 0,
      });
    });
    return () => { cancelled = true; };
  }, [activePlatform, activeStore, visibleAccountIds]);

  // COMPLETED card — real platform_status === "COMPLETED", both platforms
  // at once (unlike cardCounts above, this isn't scoped to activePlatform,
  // since the card shows Shopee+TikTok side by side regardless of which
  // platform tab is active). Same `{count:"exact",head:true}` pattern as
  // cardCounts — true full-table counts, fetched once on mount, not on
  // every platform/store switch.
  const [completedCounts, setCompletedCounts] = useState({ Shopee: 0, "TikTok Shop": 0 });
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      ["Shopee", "TikTok Shop"].map((p) =>
        supabaseClient.from("orders").select("id", { count: "exact", head: true })
          .eq("platform", DEMO_TO_DB_PLATFORM[p]).eq("platform_status", "COMPLETED"),
      ),
    ).then(([shopee, tiktok]) => {
      if (cancelled) return;
      setCompletedCounts({ Shopee: shopee.count ?? 0, "TikTok Shop": tiktok.count ?? 0 });
    });
    return () => { cancelled = true; };
  }, []);

  // COD Orders — real is_cod flag (mapped to isCod in shared.jsx's
  // mapDbOrder), from the already-loaded `orders` prop — no new query.
  const codByPlatform = ["Shopee", "TikTok Shop"].map((p) => ({
    platform: p,
    count: orders.filter((o) => o.platform === p && o.isCod).length,
  }));
  const codTotal = codByPlatform.reduce((s, p) => s + p.count, 0);

  // Courier Volume — real courier field, top 5 combined across both
  // platforms, from the already-loaded `orders` prop — no new query.
  const courierVolume = useMemo(() => {
    const counts = {};
    for (const o of orders) {
      if (!o.courier || o.courier === "—") continue;
      counts[o.courier] = (counts[o.courier] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [orders]);

  const revenue = all.filter((o) => o.status !== "已取消").reduce((s, o) => s + o.unitPrice * o.qty, 0);
  const netProfit = all.filter((o) => o.status !== "已取消").reduce((s, o) => s + profit(o), 0);

  const todayStr = new Date().toISOString().slice(0, 10);
  const date7dAgoStr = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const date30dAgoStr = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  // Shipping Priority (Overdue / Ship Today / Ship By Tomorrow) for
  // still-awaiting-shipment orders. Uses the real platform deadline
  // (`shipDeadline`, TikTok's cancel_order_sla_time — see shared.jsx) when
  // the sync has captured it for that order; falls back to the previous
  // order-age estimate for any order where it's still null (not yet
  // re-synced since this field was added, or platform doesn't return it —
  // e.g. Shopee for now). Old orders are never broken, just estimated as
  // before until a real deadline is synced for them.
  const shippingPriority = useMemo(() => {
    const toShipOrders = all.filter((o) => o.platformStatus === "AWAITING_SHIPMENT");
    const counts = { overdue: 0, shipToday: 0, shipByTomorrow: 0 };
    for (const o of toShipOrders) {
      const bucket = getShipPriorityBucket(o, todayStr, yesterdayStr, tomorrowStr);
      if (bucket) counts[bucket]++;
    }
    return counts;
  }, [all, todayStr, yesterdayStr, tomorrowStr]);

  const filtered = useMemo(() => {
    return all.filter((o) => {
      if (statusFilter === "__to_ship__") {
        // 待发货 (2026-08-03): switched from ERP-invented print_count logic
        // to TikTok's real order status — matches Seller Center 1:1 now.
        // TikTok condition unchanged; Shopee's real to-ship status is a
        // different string (READY_TO_SHIP) — additive OR, not a replacement.
        if (o.platformStatus !== "AWAITING_SHIPMENT" && o.platformStatus !== "READY_TO_SHIP") return false;
        // Instant orders moved to their own 即时订单 card/page — Shopee
        // (2026-08-17) then TikTok (2026-08-17, same day) — excluded here so
        // 待发货 (Regular Order only) and the new page never double-show the
        // same order. Gated on platform so this is a no-op for any other
        // platform that might be added later.
        if ((activePlatform === "Shopee" || activePlatform === "TikTok Shop") && isInstantOrder(o)) return false;
      } else if (statusFilter === "__to_pickup__") {
        // 待取货 (2026-08-03): real platformStatus === "AWAITING_COLLECTION".
        // TikTok condition unchanged (never appears on real TikTok rows, so
        // this stays a no-op there). PROCESSED added additively (2026-08-17,
        // authorized) — Shopee's real post-ship_order status, so an order
        // moves here immediately after a successful shopee-push-fulfillment
        // call instead of waiting for the next cron sync to relabel it.
        if (o.platformStatus !== "AWAITING_COLLECTION" && o.platformStatus !== "PROCESSED") return false;
        // Same instant-order exclusion as 待发货 above.
        if ((activePlatform === "Shopee" || activePlatform === "TikTok Shop") && isInstantOrder(o)) return false;
      } else if (statusFilter === "__instant_orders__") {
        // 即时订单 dedicated page (2026-08-17, Shopee first then TikTok same
        // day — this statusFilter value is only ever set by the platform's
        // own 即时订单 card). Two-stage flow via instantStage, same real
        // platform_status pairs 待发货/待取货 use above.
        if (!isInstantOrder(o)) return false;
        if (instantStage === "pending") {
          if (o.platformStatus !== "AWAITING_SHIPMENT" && o.platformStatus !== "READY_TO_SHIP") return false;
        } else {
          if (o.platformStatus !== "AWAITING_COLLECTION" && o.platformStatus !== "PROCESSED") return false;
        }
      } else if (statusFilter === "__in_transit__") {
        // 运输中 (2026-07-29): was o.status === "物流中", a demo-status value
        // DB_TO_DEMO_STATUS never actually produces for any real order — the
        // 运输中 card next to this chip was already reading real data via
        // platformStatus, so the chip is now pointed at the same real field
        // instead of the dead one, per explicit instruction to connect real
        // platform state where the DB genuinely has it.
        // TikTok's IN_TRANSIT unchanged; SHIPPED added additively for Shopee
        // (2026-08-17) — Shopee's real in-transit status (0 real rows ever
        // use IN_TRANSIT for Shopee, 42 real rows use SHIPPED), same
        // additive-OR pattern as 待发货/待取货 above.
        if (o.platformStatus !== "IN_TRANSIT" && o.platformStatus !== "SHIPPED") return false;
      } else if (statusFilter === "__delivered__") {
        // 已送达 (2026-07-29): was o.status === "已签收", which is even less
        // real than 物流中 — DB_TO_DEMO_STATUS never produces it either, and
        // it only ever existed as a transient local-only value set by the
        // OrderDrawer's "确认接收" button (which itself persists order_status
        // as 'shipped', not anything that maps back to 已签收). Same fix:
        // point at the real platformStatus field the card already uses.
        // TikTok stays DELIVERED-only (unchanged); Shopee additionally
        // matches COMPLETED (2026-08-17) — Shopee's real terminal delivered
        // status, per-row via o.platform so this can never affect a TikTok
        // row even when both platforms' orders are ever mixed in `all`.
        // TO_CONFIRM_RECEIVE added 2026-08-17 (explicit user classification)
        // — same per-row Shopee gate, see ORDER_CENTER_CARDS/cardCounts above.
        const isShopeeDelivered = o.platform === "Shopee" && (o.platformStatus === "COMPLETED" || o.platformStatus === "TO_CONFIRM_RECEIVE");
        if (o.platformStatus !== "DELIVERED" && !isShopeeDelivered) return false;
      } else if (statusFilter === "__completed__") {
        // 已完成 dedicated page (2026-08-17, new — bottom half of the
        // 已送达/已完成 combo card). Real platformStatus === "COMPLETED",
        // identical definition on both platforms; does not touch the
        // __delivered__ branch above at all.
        if (o.platformStatus !== "COMPLETED") return false;
      } else if (statusFilter !== "全部" && o.status !== statusFilter) {
        return false;
      }
      // Ship Today / Ship Before Tomorrow / Overdue Not Shipped click
      // filter — only meaningful within 待发货, same bucket function the 3
      // cards' own counts use (getShipPriorityBucket above), so clicking a
      // card is guaranteed to show exactly the orders it counted.
      if (priorityFilter && statusFilter === "__to_ship__" && getShipPriorityBucket(o, todayStr, yesterdayStr, tomorrowStr) !== priorityFilter) {
        return false;
      }
      if (dateMode === "custom") {
        if (dateFilter && o.date !== dateFilter) return false;
      } else if (dateMode === "today") {
        if (o.date !== todayStr) return false;
      } else if (dateMode === "7d") {
        if (o.date < date7dAgoStr || o.date > todayStr) return false;
      } else if (dateMode === "30d") {
        if (o.date < date30dAgoStr || o.date > todayStr) return false;
      }
      if (q.trim()) {
        const needle = q.trim().toLowerCase();
        const haystack = (
          searchField === "orderNo" ? o.id :
          searchField === "sku" ? o.sku :
          searchField === "product" ? o.product :
          searchField === "variation" ? o.variation :
          searchField === "sellerSku" ? o.sku :
          searchField === "tracking" ? o.tracking :
          searchField === "package" ? o.tracking :
          searchField === "customer" ? o.customer :
          searchField === "note" ? o.noteText : o.id
        ) || "";
        if (!haystack.toLowerCase().includes(needle)) return false;
      }
      return true;
    });
  }, [all, activePlatform, statusFilter, priorityFilter, instantStage, todayStr, yesterdayStr, tomorrowStr, dateMode, dateFilter, q, searchField]);

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

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex bg-white border border-slate-200 rounded-xl p-1 gap-1">
          {["Shopee", "TikTok Shop"].map((pf) => {
            const pfTheme = PLATFORM_THEME[pf];
            const active = activePlatform === pf;
            const PfLogo = pf === "Shopee" ? ShoppingBag : Music2;
            return (
              <button
                key={pf}
                onClick={() => { setActivePlatform(pf); setActiveStore(null); setStatusFilter("全部"); setSelectedIds(new Set()); }}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active ? `${pfTheme.headerBg} text-white` : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                <PfLogo size={16} className={active ? "text-white" : pf === "Shopee" ? "text-orange-500" : "text-slate-700"} />
                <span>{pf}</span>
              </button>
            );
          })}
        </div>
        <button
          onClick={() => goTo("overview")}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 btn-3d shrink-0"
        >
          <ChevronLeft size={14} />
          {t("返回总览", "Back to Dashboard")}
        </button>
      </div>

      {/* COMPLETED card — cross-platform (Shopee + TikTok side by side),
          independent of activePlatform since it summarizes both at once.
          Real platform_status === "COMPLETED" counts, see completedCounts
          above. */}
      <div className="glass-surface rounded-2xl p-4 flex items-center gap-3 card-3d">
        <div className="h-12 w-12 rounded-2xl flex items-center justify-center icon-badge-3d shrink-0 bg-gradient-to-br from-emerald-400 to-emerald-600">
          <PackageCheck size={20} className="text-white" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-slate-500 mb-0.5 truncate">{t("已完成订单", "Completed")}</div>
          <div className="text-2xl font-semibold tabular-nums">{completedCounts.Shopee + completedCounts["TikTok Shop"]}</div>
          <div className="flex items-center gap-3 mt-1">
            {["Shopee", "TikTok Shop"].map((p) => {
              const Icon = PLATFORM_ICON[p];
              return (
                <span key={p} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                  <Icon size={12} className={p === "Shopee" ? "text-orange-500" : "text-rose-600"} />
                  {PLATFORM_SHORT_LABEL[p]} <span className="font-semibold tabular-nums text-slate-600">{completedCounts[p]}</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* COD Orders — real is_cod, from already-loaded orders prop, no new
          query. Cross-platform, same pattern as the COMPLETED card above. */}
      <div className="glass-surface rounded-2xl p-4 flex items-center gap-3 card-3d">
        <div className="h-12 w-12 rounded-2xl flex items-center justify-center icon-badge-3d shrink-0 bg-gradient-to-br from-cyan-400 to-cyan-600">
          <CreditCard size={20} className="text-white" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-slate-500 mb-0.5 truncate">{t("COD 订单", "COD Orders")}</div>
          <div className="text-2xl font-semibold tabular-nums">{codTotal}</div>
          <div className="flex items-center gap-3 mt-1">
            {codByPlatform.map((p) => {
              const Icon = PLATFORM_ICON[p.platform];
              return (
                <span key={p.platform} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                  <Icon size={12} className={p.platform === "Shopee" ? "text-orange-500" : "text-rose-600"} />
                  {PLATFORM_SHORT_LABEL[p.platform]} <span className="font-semibold tabular-nums text-slate-600">{p.count}</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Courier Volume — real courier field, combined, top 5, from
          already-loaded orders prop, no new query. */}
      <div className="glass-surface rounded-2xl p-4 card-3d">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-12 w-12 rounded-2xl flex items-center justify-center icon-badge-3d shrink-0 bg-gradient-to-br from-indigo-400 to-indigo-600">
            <Truck size={20} className="text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-slate-500 mb-0.5 truncate">{t("快递商订单量", "Courier Volume")}</div>
            <div className="text-2xl font-semibold tabular-nums">{orders.filter((o) => o.courier && o.courier !== "—").length}</div>
          </div>
        </div>
        <div className="space-y-1">
          {courierVolume.map(([name, count]) => (
            <div key={name} className="flex items-center justify-between text-xs text-slate-600">
              <span className="truncate">{name}</span>
              <span className="font-semibold tabular-nums text-slate-700">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 店铺卡片行 — 平台按钮不再绑定单一店铺，改成平台下面列出该平台所有店铺，
          每张卡片独立可点，点击后再按 platformAccountId 过滤订单列表（activeStore）。
          没有真实已连接店铺时显示占位卡片（不可点，仅供 UI 预览）。 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setActiveStore(null)}
          className={`text-xs px-3 py-2 rounded-lg border ${
            activeStore === null ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          }`}
        >
          {t("全部店铺", "All Stores")}
        </button>
        {platformStores.length > 0
          ? platformStores.map((s) => {
              const storeOrderCount = orders.filter((o) => o.platform === activePlatform && o.platformAccountId === s.id).length;
              const isActive = activeStore === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveStore(s.id)}
                  className={`text-left text-xs px-3 py-2 rounded-lg border ${
                    isActive ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <div className="font-medium">{s.name}</div>
                  <div className={isActive ? "text-white/80" : "text-slate-400"}>{t(`订单数量：${storeOrderCount}`, `Orders: ${storeOrderCount}`)}</div>
                </button>
              );
            })
          : ["示例店铺 A", "示例店铺 B"].map((name) => (
              <div key={name} className="text-left text-xs px-3 py-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed">
                <div className="font-medium">{name}（{t("示例", "sample")}）</div>
                <div>{t("订单数量：0", "Orders: 0")}</div>
              </div>
            ))}
      </div>

      <div className={`rounded-2xl border ${theme.border} overflow-hidden bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-16px_rgba(15,23,42,0.15)]`}>
        <div className={`${theme.headerBg} text-white px-5 py-4 flex items-center justify-between glass-panel`}>
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
          {/* "delivered" is rendered separately now, as the top half of the
              已送达/已完成 combo card below (2026-08-17 restructure) — filtered
              out of this plain single-card loop so it doesn't render twice. */}
          {ORDER_CENTER_CARDS.filter((card) => card.key !== "delivered").map((card) => {
            const count = cardCounts[card.key] ?? all.filter(card.match).length;
            const Icon = card.icon;
            const clickable = card.filterValue !== undefined;
            const active = clickable && statusFilter === card.filterValue;
            const CardTag = clickable ? "button" : "div";
            return (
              <CardTag
                key={card.key}
                type={clickable ? "button" : undefined}
                onClick={clickable ? () => setStatusFilter(card.filterValue) : undefined}
                className={`bg-white rounded-2xl border-2 ${active ? "border-purple-400" : "border-slate-200"} px-3 py-3 flex flex-col items-center justify-center gap-1.5 card-3d ${clickable ? "cursor-pointer hover:border-slate-300" : ""}`}
              >
                <div className={`h-8 w-8 rounded-full flex items-center justify-center icon-badge-3d ${card.iconBg}`}>
                  <Icon size={14} className={card.iconColor} />
                </div>
                <div className="text-xs text-slate-500">{t(card.zh, card.en)}</div>
                {card.key !== "all" && (
                  <div className={`text-lg font-bold tabular-nums ${card.numberColor}`}>{count}</div>
                )}
              </CardTag>
            );
          })}
          {/* 已送达 + 已完成, combined two-tier card (2026-08-17, explicit UI
              restructure — replaces the old standalone 已送达 card, applies
              to both Shopee and TikTok). Same shared-frame pattern as the
              two split cards below, but intentionally shows no count on
              either half — the real total only loads on the dedicated page
              once clicked (see the banner above the order list). */}
          <div className={`bg-white rounded-2xl border-2 ${(statusFilter === "__delivered__" || statusFilter === "__completed__") ? "border-purple-400" : "border-slate-200"} flex flex-col divide-y divide-slate-100 card-3d`}>
            {[DELIVERED_COMPLETED_SPLIT_CARD.top, DELIVERED_COMPLETED_SPLIT_CARD.bottom].map((half) => {
              const Icon = half.icon;
              const active = statusFilter === half.filterValue;
              return (
                <button
                  key={half.zh}
                  type="button"
                  onClick={() => setStatusFilter(half.filterValue)}
                  className={`flex-1 w-full flex flex-col items-center justify-center gap-1 py-1.5 cursor-pointer hover:bg-slate-50 ${active ? "bg-slate-50" : ""}`}
                >
                  <div className={`h-6 w-6 rounded-full flex items-center justify-center icon-badge-3d ${half.iconBg}`}>
                    <Icon size={12} className={half.iconColor} />
                  </div>
                  <div className="text-[11px] text-slate-500 leading-none">{t(half.zh, half.en)}</div>
                </button>
              );
            })}
          </div>
          {/* 8th slot: 投递失败 + 已取消 in one card — same outer rounded/
              background as the other 7, each half reusing the same icon-
              then-label-then-number vertical stack (just smaller) so it reads
              as one unified stat card. Only the 已取消 half is clickable (same
              filterValue its chip uses); 投递失败 has no filterValue, stays
              plain. The shared outer border goes purple when 已取消 is active. */}
          <div className={`bg-white rounded-2xl border-2 ${statusFilter === "已取消" ? "border-purple-400" : "border-slate-200"} flex flex-col divide-y divide-slate-100 card-3d`}>
            {[FAILED_CANCELLED_SPLIT_CARD.top, FAILED_CANCELLED_SPLIT_CARD.bottom].map((half) => {
              // 已取消: main number restored to the true total (cardCounts.cancelled,
              // already fetched above, order_status==='cancelled', no date filter) —
              // "今天取消" shown as a separate small line below using the other
              // already-fetched value (cardCounts.cancelledToday). No new query.
              const isCancelled = half.filterValue === "已取消";
              const count = (isCancelled ? cardCounts.cancelled : cardCounts.failed) ?? all.filter(half.match).length;
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
                  <div className={`h-6 w-6 rounded-full flex items-center justify-center icon-badge-3d ${half.iconBg}`}>
                    <Icon size={12} className={half.iconColor} />
                  </div>
                  <div className="text-[11px] text-slate-500 leading-none">{t(half.zh, half.en)}</div>
                  <div className={`text-sm font-bold tabular-nums leading-none ${isCancelled ? "text-red-600" : half.numberColor}`}>{count}</div>
                  {isCancelled && (
                    <div className="text-[10px] text-slate-400 leading-none mt-0.5">
                      {t(`今天取消 ${cardCounts.cancelledToday ?? 0}`, `Cancelled Today ${cardCounts.cancelledToday ?? 0}`)}
                    </div>
                  )}
                </HalfTag>
              );
            })}
          </div>

          {/* 未付款 + 退货/退款, same shared-frame pattern as the split card
              above — same data (cardCounts.unpaid / cardCounts.returned),
              same click behavior (未付款 stays non-clickable, 退货/退款 keeps
              its existing filterValue "退款中"), just grouped into one box. */}
          <div className={`bg-white rounded-2xl border-2 ${statusFilter === "退款中" ? "border-purple-400" : "border-slate-200"} flex flex-col divide-y divide-slate-100 card-3d`}>
            {[UNPAID_RETURNED_SPLIT_CARD.top, UNPAID_RETURNED_SPLIT_CARD.bottom].map((half) => {
              const count = (half.filterValue === "退款中" ? cardCounts.returned : cardCounts.unpaid) ?? all.filter(half.match).length;
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
                  <div className={`h-6 w-6 rounded-full flex items-center justify-center icon-badge-3d ${half.iconBg}`}>
                    <Icon size={12} className={half.iconColor} />
                  </div>
                  <div className="text-[11px] text-slate-500 leading-none">{t(half.zh, half.en)}</div>
                  <div className={`text-sm font-bold tabular-nums leading-none ${half.numberColor}`}>{count}</div>
                </HalfTag>
              );
            })}
          </div>

          {/* 即时订单 — standalone card, first built Shopee-only (2026-08-17,
              authorized UI restructure), then mirrored for TikTok the same
              day (also authorized) using the same statusFilter/instantStage
              machinery — isInstantOrder/excludeInstant/onlyInstant already
              branch per-platform (courier for Shopee, delivery_option for
              TikTok), so this card and its sub-tabs work unchanged for
              either platform once rendered. Clicking switches to its own
              dedicated 待发货/待取货 two-stage view (see the sub-tabs +
              `filtered` branch above) instead of being mixed into the
              regular 待发货 card/list — that card now excludes these orders
              entirely (see the __to_ship__/__to_pickup__ branches above).
              Count is the sum of both stages so the card reads as "all
              instant orders right now" regardless of which stage the click
              lands on. */}
          {(activePlatform === "Shopee" || activePlatform === "TikTok Shop") && (
            <button
              type="button"
              onClick={() => setStatusFilter("__instant_orders__")}
              className={`bg-white rounded-2xl border-2 ${statusFilter === "__instant_orders__" ? "border-purple-400" : "border-slate-200"} px-3 py-3 flex flex-col items-center justify-center gap-1.5 card-3d cursor-pointer hover:border-slate-300`}
            >
              <div className="h-8 w-8 rounded-full flex items-center justify-center icon-badge-3d bg-gradient-to-br from-purple-400 to-purple-600">
                <Zap size={14} className="text-white" />
              </div>
              <div className="text-xs text-slate-500">{t("即时订单", "Instant Order")}</div>
              <div className="text-lg font-bold tabular-nums text-purple-600">{(cardCounts.instantToProcess ?? 0) + (cardCounts.instantProcessed ?? 0)}</div>
            </button>
          )}
        </div>

        <div className="px-5 pt-3">
          <div className="flex gap-2">
            <select
              value={searchField}
              onChange={(e) => setSearchField(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg outline-none text-slate-600 px-2 bg-white shrink-0"
            >
              <option value="orderNo">{t("订单号", "Order No.")}</option>
              <option value="sku">{t("店铺SKU", "Store SKU")}</option>
              <option value="product">{t("产品名称", "Product Name")}</option>
              <option value="variation">{t("商品 Variation", "Variation")}</option>
              <option value="sellerSku">{t("Seller SKU", "Seller SKU")}</option>
              <option value="tracking">{t("运单号", "Tracking No.")}</option>
              <option value="package">{t("包裹号", "Package No.")}</option>
              <option value="customer">{t("买家名称", "Buyer Name")}</option>
              <option value="note">{t("备注", "Note")}</option>
            </select>
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t(`在 ${activePlatform} 内搜索`, `Search in ${activePlatform}`)}
                className={`w-full pl-9 pr-3 py-3 text-sm border border-slate-200 rounded-lg outline-none input-3d ${theme.ring}`}
              />
            </div>
            <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 shrink-0">
              <Clock size={13} className="text-slate-400 shrink-0" />
              <select
                value={dateMode}
                onChange={(e) => setDateMode(e.target.value)}
                className="text-xs outline-none text-slate-600 py-2 bg-white"
              >
                <option value="all">{t("全部时间", "All Time")}</option>
                <option value="today">{t("今天", "Today")}</option>
                <option value="7d">{t("7天", "7 Days")}</option>
                <option value="30d">{t("30天", "30 Days")}</option>
                <option value="custom">{t("自定义日期", "Custom Date")}</option>
              </select>
              {dateMode === "custom" && (
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="text-xs outline-none text-slate-600 py-2"
                />
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

        {/* 即时订单 dedicated page sub-tabs (2026-08-17, Shopee first then
            TikTok same day) — this view is only ever reached via either
            platform's own 即时订单 card, so no platform gate needed here.
            Two stages, same real platform_status pairs 待发货/待取货 use
            elsewhere, via cardCounts.instantToProcess/instantProcessed (same
            live head-count query pattern, no new query shape). Replaces the
            old instantFilter toggle that used to live inside the 待发货 view
            itself — instant orders no longer appear there at all now (see
            `filtered` above), this page is their only home. */}
        {statusFilter === "__instant_orders__" && (
          <div className={`px-5 pt-3 border-t border-slate-100 ${theme.bgWash} flex items-center gap-[0.5cm]`}>
            <button
              type="button"
              onClick={() => setInstantStage("pending")}
              className={`h-[1cm] px-3 bg-white rounded-full border flex items-center gap-1 card-3d overflow-hidden shrink-0 cursor-pointer transition-3d ${
                instantStage === "pending" ? "border-purple-400 ring-1 ring-purple-400" : "border-slate-200"
              }`}
            >
              <div className="h-4 w-4 rounded-full flex items-center justify-center icon-badge-3d shrink-0 bg-gradient-to-br from-red-400 to-red-600">
                <PackagePlus size={9} className="text-white" />
              </div>
              <div className="min-w-0 text-[9px] text-slate-600 truncate leading-none">
                {t("待发货/待处理", "To Process")} <span className="font-bold tabular-nums text-red-600">({cardCounts.instantToProcess ?? 0})</span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setInstantStage("processed")}
              className={`h-[1cm] px-3 bg-white rounded-full border flex items-center gap-1 card-3d overflow-hidden shrink-0 cursor-pointer transition-3d ${
                instantStage === "processed" ? "border-purple-400 ring-1 ring-purple-400" : "border-slate-200"
              }`}
            >
              <div className="h-4 w-4 rounded-full flex items-center justify-center icon-badge-3d shrink-0 bg-gradient-to-br from-blue-400 to-blue-600">
                <ShoppingCart size={9} className="text-white" />
              </div>
              <div className="min-w-0 text-[9px] text-slate-600 truncate leading-none">
                {t("待取货/已处理", "Processed")} <span className="font-bold tabular-nums text-blue-600">({cardCounts.instantProcessed ?? 0})</span>
              </div>
            </button>
          </div>
        )}

        {/* 已送达/已完成 dedicated page banners (2026-08-17, now both
            platforms — the combo card above never shows a count on either
            half for either platform anymore, so both need somewhere to
            reveal the real total once clicked through). cardCounts.delivered
            already includes the Shopee COMPLETED/TO_CONFIRM_RECEIVE fix;
            cardCounts.completed is the new platform/store-scoped COMPLETED
            count added alongside it. */}
        {statusFilter === "__delivered__" && (
          <div className={`px-5 pt-3 border-t border-slate-100 ${theme.bgWash}`}>
            <div className="text-sm font-medium text-slate-700">
              {t(`已送达订单页面 · 共 ${cardCounts.delivered ?? all.filter(DELIVERED_COMPLETED_SPLIT_CARD.top.match).length} 笔`, `Delivered Orders · ${cardCounts.delivered ?? all.filter(DELIVERED_COMPLETED_SPLIT_CARD.top.match).length} total`)}
            </div>
          </div>
        )}
        {statusFilter === "__completed__" && (
          <div className={`px-5 pt-3 border-t border-slate-100 ${theme.bgWash}`}>
            <div className="text-sm font-medium text-slate-700">
              {t(`已完成订单页面 · 共 ${cardCounts.completed ?? all.filter(DELIVERED_COMPLETED_SPLIT_CARD.bottom.match).length} 笔`, `Completed Orders · ${cardCounts.completed ?? all.filter(DELIVERED_COMPLETED_SPLIT_CARD.bottom.match).length} total`)}
            </div>
          </div>
        )}

        {/* Shipping Priority shortcut row (2026-08-08, moved+made conditional
            per explicit instruction) — only shown while the 待发货/To Ship
            filter is active, positioned below the status chips and above
            "全选本页". Overdue / Ship Today / Ship By Tomorrow: uses the real
            platform deadline (shipDeadline) when synced, falling back to
            the order-age estimate otherwise (see getShipPriorityBucket).
            Clicking a card narrows the list below to exactly that bucket —
            same bucket function as the count, so number and filter can't
            drift apart; clicking the active card again clears it. */}
        {statusFilter === "__to_ship__" && (
          <div className={`px-5 py-3 border-t border-slate-100 ${theme.bgWash} flex items-center gap-[0.5cm]`}>
            {[
              { key: "shipToday", zh: "今日需发货", en: "Ship Today", icon: Clock, iconBg: "bg-gradient-to-br from-amber-400 to-amber-600", numberColor: "text-amber-600", count: shippingPriority.shipToday },
              // Widened (2026-08-09) — 明日前需发货's zh label + count were
              // being clipped at the shared 3cm width; only this card's
              // width changed (CSS only, no data/logic change).
              { key: "shipByTomorrow", zh: "明日前需发货", en: "Ship Before Tomorrow", icon: Truck, iconBg: "bg-gradient-to-br from-blue-400 to-blue-600", numberColor: "text-blue-600", count: shippingPriority.shipByTomorrow, width: "w-[3.6cm]" },
              { key: "overdue", zh: "逾期未发货", en: "Overdue Not Shipped", icon: AlertTriangle, iconBg: "bg-gradient-to-br from-red-400 to-red-600", numberColor: "text-red-600", count: shippingPriority.overdue },
            ].map((card) => {
              const Icon = card.icon;
              const active = priorityFilter === card.key;
              return (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => setPriorityFilter((prev) => (prev === card.key ? null : card.key))}
                  className={`h-[1cm] ${card.width || "w-[3cm]"} bg-white rounded-full border px-2 flex items-center gap-1 card-3d overflow-hidden shrink-0 cursor-pointer transition-3d ${
                    active ? "border-purple-400 ring-1 ring-purple-400" : "border-slate-200"
                  }`}
                >
                  <div className={`h-4 w-4 rounded-full flex items-center justify-center icon-badge-3d shrink-0 ${card.iconBg}`}>
                    <Icon size={9} className="text-white" />
                  </div>
                  <div className="min-w-0 text-[9px] text-slate-600 truncate leading-none">
                    {t(card.zh, card.en)} <span className={`font-bold tabular-nums ${card.numberColor}`}>({card.count})</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50 flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-3.5 w-3.5 rounded border-slate-300" />
            {t(`全选本页（${filtered.length} 笔）`, `Select all on this page (${filtered.length})`)}
          </label>
          <span className="text-xs text-slate-400">{t(`已选 ${selectedOrders.length} 笔`, `${selectedOrders.length} selected`)}</span>
          {onMarkPicked && !hidePickPack && (() => {
            // 已取消/未付款订单不能拣货/包装/打印 — 只影响这三个按钮的可操作对象，不改 selectedOrders 本身。
            const actionableOrders = selectedOrders.filter((o) => o.status !== "已取消" && o.platformStatus !== "UNPAID" && o.platformStatus !== "IN_TRANSIT" && o.platformStatus !== "DELIVERED" && o.platformStatus !== "COMPLETED");
            const selectedPickable = actionableOrders.filter((o) => (o.warehouseStage || "pending") === "pending");
            // 全部 mixes every status together — 拣货完成 stays visible but
            // inert there, same treatment as the print buttons; still fully
            // functional in every specific status view (待取货/退款/etc).
            const pickDisabled = statusFilter === "全部" || selectedPickable.length === 0;
            return (
              <button
                onClick={() => statusFilter !== "全部" && selectedPickable.length > 0 && onMarkPicked(selectedPickable.map((o) => o.id))}
                disabled={pickDisabled}
                title={statusFilter === "全部" ? t("请先筛选具体订单状态再拣货", "Filter to a specific status before marking picked") : t("拣货完成，打印前必须先完成拣货", "Mark picked — required before printing")}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl ml-auto btn-3d ${
                  !pickDisabled ? "bg-gradient-to-r from-amber-400 to-amber-600 text-white hover:brightness-105" : "bg-slate-200 text-slate-400 cursor-not-allowed"
                }`}
              >
                <PackageOpen size={13} /> {t(`拣货完成（${selectedPickable.length}）`, `Mark Picked (${selectedPickable.length})`)}
              </button>
            );
          })()}
          {onMarkPacked && !hidePickPack && (() => {
            const actionableOrders = selectedOrders.filter((o) => o.status !== "已取消" && o.platformStatus !== "UNPAID" && o.platformStatus !== "IN_TRANSIT" && o.platformStatus !== "DELIVERED" && o.platformStatus !== "COMPLETED");
            const selectedPackable = actionableOrders.filter((o) => o.warehouseStage === "picked");
            return (
              <button
                onClick={() => selectedPackable.length > 0 && onMarkPacked(selectedPackable.map((o) => o.id))}
                disabled={selectedPackable.length === 0}
                title={t("包装完成，打印前必须先完成包装（此步骤会扣减库存）", "Mark packed — required before printing (deducts stock)")}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl btn-3d ${
                  selectedPackable.length > 0 ? "bg-gradient-to-r from-indigo-400 to-indigo-600 text-white hover:brightness-105" : "bg-slate-200 text-slate-400 cursor-not-allowed"
                }`}
              >
                <PackageCheck size={13} /> {t(`包装完成（${selectedPackable.length}）`, `Mark Packed (${selectedPackable.length})`)}
              </button>
            );
          })()}
          {(() => {
            // 已取消/未付款订单不能打印。待发货 (__to_ship__) 视图下打印额外要求拣货+包装完成；
            // 其他视图下的打印行为不变（除了已取消/未付款这两类被排除）。
            const actionableOrders = selectedOrders.filter((o) => o.status !== "已取消" && o.platformStatus !== "UNPAID" && o.platformStatus !== "IN_TRANSIT" && o.platformStatus !== "DELIVERED" && o.platformStatus !== "COMPLETED");
            // __instant_orders__ (2026-08-17) follows the same pack-before-
            // print rule as __to_ship__ — it's the same real Shopee shipment
            // flow, just viewed on its own page.
            const printGated = statusFilter === "__to_ship__" || statusFilter === "__instant_orders__";
            const printBlocked = printGated && actionableOrders.some((o) => o.warehouseStage !== "ready_ship");
            // 全部 mixes every status/warehouse_stage together, so batch
            // printing is disabled there — real printing only allowed from
            // a specific status view (待发货/待取货/etc). Display-only: no
            // change to what gets printed or how, in any other view.
            const printDisabled = statusFilter === "全部" || actionableOrders.length === 0 || printBlocked;
            return (
              <button
                onClick={() => statusFilter !== "全部" && actionableOrders.length > 0 && !printBlocked && onPrint(actionableOrders)}
                disabled={printDisabled}
                title={statusFilter === "全部" ? t("请先筛选具体订单状态再打印", "Filter to a specific status before printing") : printBlocked ? t("待发货订单需先完成拣货+包装才能打印", "To-ship orders must be picked + packed before printing") : undefined}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl btn-3d ${
                  !printDisabled ? "bg-gradient-to-r from-slate-700 to-slate-900 text-white hover:brightness-110" : "bg-slate-200 text-slate-400 cursor-not-allowed"
                }`}
              >
                <Printer size={13} /> {t(`批量打印订单单（${actionableOrders.length}）`, `Batch print order slips (${actionableOrders.length})`)}
              </button>
            );
          })()}
          {activePlatform === "TikTok Shop" && (() => {
            const shippable = selectedOrders.filter((o) => o.platform === "TikTok Shop" && o.platformStatus === "AWAITING_SHIPMENT");
            return (
              <button
                onClick={() => shippable.length > 0 && setShipConfirmOpen(true)}
                disabled={shippable.length === 0 || shipBatchStatus === "loading"}
                title={t("确认发货：真实调用TikTok发货API，不可撤销", "Confirm ship — calls the real TikTok ship API, cannot be undone")}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl btn-3d ${
                  shippable.length > 0 && shipBatchStatus !== "loading" ? "bg-gradient-to-r from-red-500 to-red-600 text-white hover:brightness-105" : "bg-slate-200 text-slate-400 cursor-not-allowed"
                }`}
              >
                <Send size={13} /> {shipBatchStatus === "loading" ? t("处理中…", "Processing…") : t(`确认发货（${shippable.length}）`, `Confirm Ship (${shippable.length})`)}
              </button>
            );
          })()}
          {activePlatform === "Shopee" && (() => {
            const shippable = selectedOrders.filter((o) => o.platform === "Shopee" && o.platformStatus === "READY_TO_SHIP");
            return (
              <button
                onClick={() => shippable.length > 0 && setShopeeShipConfirmOpen(true)}
                disabled={shippable.length === 0 || shopeeShipBatchStatus === "loading"}
                title={t("确认发货：真实调用Shopee发货API，不可撤销", "Confirm ship — calls the real Shopee ship API, cannot be undone")}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl btn-3d ${
                  shippable.length > 0 && shopeeShipBatchStatus !== "loading" ? "bg-gradient-to-r from-orange-500 to-orange-600 text-white hover:brightness-105" : "bg-slate-200 text-slate-400 cursor-not-allowed"
                }`}
              >
                <Send size={13} /> {shopeeShipBatchStatus === "loading" ? t("处理中…", "Processing…") : t(`确认发货（${shippable.length}）`, `Confirm Ship (${shippable.length})`)}
              </button>
            );
          })()}
        </div>

        {shipConfirmOpen && (() => {
          const shippable = selectedOrders.filter((o) => o.platform === "TikTok Shop" && o.platformStatus === "AWAITING_SHIPMENT");
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30" onClick={() => setShipConfirmOpen(false)}>
              <div className="bg-white rounded-xl shadow-xl p-5 w-72" onClick={(e) => e.stopPropagation()}>
                <div className="text-sm font-semibold mb-3">{t("打印", "Print")}</div>
                <div className="flex gap-2">
                  <button onClick={() => runShipBatch(shippable)} className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm btn-3d">{t("打印", "Print")}</button>
                  <button onClick={() => setShipConfirmOpen(false)} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm">{t("取消", "Cancel")}</button>
                </div>
              </div>
            </div>
          );
        })()}

        {shopeeShipConfirmOpen && (() => {
          const shippable = selectedOrders.filter((o) => o.platform === "Shopee" && o.platformStatus === "READY_TO_SHIP");
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30" onClick={() => setShopeeShipConfirmOpen(false)}>
              <div className="bg-white rounded-xl shadow-xl p-5 w-72" onClick={(e) => e.stopPropagation()}>
                <div className="text-sm font-semibold mb-3">{t("确认发货", "Confirm Ship")}</div>
                <div className="flex gap-2">
                  <button onClick={() => runShopeeShipBatch(shippable)} className="flex-1 py-2 rounded-lg bg-orange-600 text-white text-sm btn-3d">{t("确认", "Confirm")}</button>
                  <button onClick={() => setShopeeShipConfirmOpen(false)} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm">{t("取消", "Cancel")}</button>
                </div>
              </div>
            </div>
          );
        })()}

        <div className="border-t border-slate-100 divide-y divide-slate-100">
          {filtered.length === 0 && <div className="px-5 py-6 text-xs text-slate-400 text-center">{t("没有符合条件的订单", "No orders match the current filters")}</div>}
          {filtered.map((o) => (
            <div key={o.id} className="w-full px-5 py-3 hover:bg-slate-50 flex flex-wrap items-start gap-3 row-3d">
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
                    className="flex items-center justify-center gap-1 text-[10px] px-2 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 btn-3d"
                  >
                    <CheckCircle2 size={11} /> {t("确认处理", "Confirm Process")}
                  </button>
                )}
                <button
                  onClick={() => statusFilter !== "全部" && onPrint([o])}
                  disabled={statusFilter === "全部"}
                  title={statusFilter === "全部" ? t("请先筛选具体订单状态再打印", "Filter to a specific status before printing") : t("打印订单单", "Print order slip")}
                  className={`flex items-center justify-center gap-1 text-[10px] px-2 py-1 rounded-full border btn-3d ${
                    statusFilter === "全部" ? "border-slate-100 text-slate-300 cursor-not-allowed" : "border-slate-200 text-slate-500 hover:bg-slate-100"
                  }`}
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
                      setNotePopupPos(null);
                    } else {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const POPUP_WIDTH = 224; // w-56
                      const POPUP_HEIGHT = 150; // approx, with room to spare
                      setNoteEditingId(o.id);
                      setNoteDraftText(o.noteText || "");
                      setNoteDraftColor(o.noteColor || null);
                      setNotePopupPos({
                        top: Math.min(rect.bottom + 4, window.innerHeight - POPUP_HEIGHT - 8),
                        left: Math.min(rect.left, window.innerWidth - POPUP_WIDTH - 8),
                      });
                    }
                  }}
                  title={o.noteText || t("添加备注", "Add note")}
                  className="h-4 w-4 rounded-full border border-slate-300"
                  style={o.noteColor ? { backgroundColor: NOTE_COLORS[o.noteColor], borderColor: NOTE_COLORS[o.noteColor] } : undefined}
                />
                {/* Rendered via portal into document.body — the popup used to be
                    clipped by the scrollable order list even as position:fixed
                    (real production report). A portal removes it from the list's
                    DOM subtree entirely, so no ancestor overflow/transform/
                    stacking context can clip or cover it; z-[80] sits above
                    every existing layer (sidebar z-50, PrintSlip z-[60],
                    HistoryPreviewModal z-[70]). Coordinates still come from the
                    trigger's getBoundingClientRect, viewport-clamped. */}
                {noteEditingId === o.id && notePopupPos && createPortal(
                  <div
                    className="fixed z-[80] w-56 bg-white border-2 border-red-500 rounded-lg shadow-lg p-2.5"
                    style={{ top: notePopupPos.top, left: notePopupPos.left }}
                    onClick={(e) => e.stopPropagation()}
                  >
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
                      onClick={() => { onUpdateNote(o.id, noteDraftColor, noteDraftText); setNoteEditingId(null); setNotePopupPos(null); }}
                      className="mt-2 w-full text-xs py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
                    >
                      {t("保存", "Save")}
                    </button>
                  </div>,
                  document.body,
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
                {/* Renders every line item on the order (main product(s) +
                    any free-gift SKU), not just one — a Shopee/TikTok order
                    with a gift line (e.g. 260817JW253WNF: RK chain set +
                    "NOT FOR SELL" gift) used to show only whichever single
                    item mapDbOrder's unordered DB fetch happened to land on
                    first, sometimes the gift instead of the real product.
                    Falls back to the single o.product/o.sku fields only if
                    o.items is ever empty (shouldn't happen for a synced
                    order, but keeps this from rendering blank). */}
                <div className="mt-1.5 space-y-1.5">
                  {(o.items && o.items.length > 0 ? o.items : [{ sku: o.sku, productName: o.product, image: o.productImage, variation: o.variation, qty: o.qty }]).map((it, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      {it.image ? (
                        <img src={it.image} alt={it.productName} className="h-9 w-9 rounded-lg object-cover border border-slate-200 shrink-0" />
                      ) : (
                        <div className="h-9 w-9 rounded-lg bg-slate-100 border border-slate-200 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-700 truncate">{it.productName}</div>
                        <div className="text-[11px] text-slate-400 truncate mt-0.5 flex items-center gap-1">
                          <span className="truncate">
                            {it.variation ? `${it.variation} · ` : ""}{t("Seller SKU", "Seller SKU")}: {it.sku || t("（无SKU）", "(no SKU)")} × {it.qty}
                          </span>
                          {idx === 0 && o.skuStatus === "missing" && (
                            <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-600 border border-rose-200">
                              <AlertTriangle size={9} /> {t("缺SKU", "Missing SKU")}
                            </span>
                          )}
                          {idx === 0 && o.skuStatus === "unlinked" && (
                            <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                              <AlertTriangle size={9} /> {t("系统未登记", "Not registered")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
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

export function OrderDrawer({ t, order, onClose, onPrint, onUpdateStatus, onRequestCancel }) {
  // Real platformStatus condition (2026-08-20) — same one the 待发货 card
  // itself already uses (ORDER_STATUS_LABELS.toShip / __to_ship__ filter
  // above: TikTok AWAITING_SHIPMENT, Shopee READY_TO_SHIP), NOT the legacy
  // order.status demo label. Originally gated the Shopee-style layout to
  // 待发货 only; widened (2026-08-20, second explicit one-time exception,
  // confirmed with the user) to cover every status under 全部 — this value
  // is still threaded through so the shared component below can adjust its
  // top action button's wording for the pre-ship vs. post-ship case.
  const isAwaitingShip = order.platformStatus === "AWAITING_SHIPMENT" || order.platformStatus === "READY_TO_SHIP";
  const stepIdx = STATUS_STEPS.indexOf(order.status);
  const theme = PLATFORM_THEME[order.platform];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="relative w-[800px] max-w-[92vw] bg-white h-full shadow-xl overflow-y-auto">
        <ShopeeStyleOrderDrawerContent
          t={t} order={order} onClose={onClose} onPrint={onPrint}
          onUpdateStatus={onUpdateStatus} onRequestCancel={onRequestCancel}
          stepIdx={stepIdx} theme={theme} isAwaitingShip={isAwaitingShip}
        />
      </div>
    </div>
  );
}

// Shopee-style order detail — 1:1 layout match per explicit request.
// Originally built 2026-08-20 for 待发货 only (one-time exception to the
// standing don't-touch-other-cards rule); widened the same day (second
// explicit one-time exception, confirmed with the user) to be the single
// detail view for every status under 全部 — this is now the ONLY drawer
// body OrderDrawer renders. Only reads existing real data (order fields
// already on the mapped order, plus a read-only order_settlements lookup
// reusing pagesImportFinance.jsx's own incomeBreakdown/estimatedBreakdown)
// — no new backend/API/sync logic, purely a UI restructure. The top action
// button reuses the existing onPrint callback (same action already
// available via the header's print button elsewhere) — deliberately NOT
// wired to the real, irreversible ship-API batch flow (runShipBatch/
// runShopeeShipBatch in the Orders component above), which stays exactly
// as-is per "不需要更改接口逻辑". 确认接收/登记退货 and the 已取消/退款中
// banner are carried over unchanged from the previous non-Shopee-style
// fallback (now retired) so no existing functionality is lost — only its
// presentation moved.
const CANCELLABLE_PLATFORM_STATUSES = new Set([
  "UNPAID", "READY_TO_SHIP", "AWAITING_SHIPMENT", "PROCESSED", "AWAITING_COLLECTION",
]);

function ShopeeStyleOrderDrawerContent({ t, order, onClose, onPrint, onUpdateStatus, onRequestCancel, stepIdx, theme, isAwaitingShip }) {
  const lang = t("zh", "en");
  const [settlement, setSettlement] = useState(null);
  const [settlementLoading, setSettlementLoading] = useState(true);
  const [showIncomeDetail, setShowIncomeDetail] = useState(false);
  const [showPaymentDetail, setShowPaymentDetail] = useState(false);
  // 即时聊天 copy-to-clipboard toast (2026-08-20) — see button below. Local,
  // self-dismissing (2.5s), scoped to this drawer only.
  const [chatToast, setChatToast] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setSettlementLoading(true);
    setSettlement(null);
    const dbPlatform = DEMO_TO_DB_PLATFORM[order.platform];
    if (!dbPlatform) { setSettlementLoading(false); return; }
    supabaseClient
      .from("order_settlements")
      .select("*")
      .eq("order_no", order.id)
      .eq("platform", dbPlatform)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) { setSettlement(data || null); setSettlementLoading(false); }
      });
    return () => { cancelled = true; };
  }, [order.id, order.platform]);

  const hasRealData = !!settlement;
  // isEstimate (2026-08-20, bug fix) — must check settlement.is_final, not
  // just "a settlement row exists". A 待发货 order can only ever have a
  // real PRE-settlement estimate (is_final=false, written by
  // shopee-pending-estimate-sync) since it hasn't completed yet — using
  // just `!hasRealData` mislabeled that as "最终到账金额" (Final) instead
  // of "预估到账金额" (Estimate) the first time this was wired up.
  const isFinalSettlement = !!(settlement && settlement.is_final);
  const incomeDetail = hasRealData ? incomeBreakdown(order, settlement, t) : estimatedBreakdown(order, t);
  // Real buyer_payment_info (2026-08-20) — Shopee's own get_escrow_detail
  // response, same raw_response already stored by shopee-pending-estimate-sync.
  const buyerPaymentInfo = settlement?.raw_response?.response?.buyer_payment_info || null;
  const num = (v) => Number(v || 0);

  const items = order.items && order.items.length > 0
    ? order.items
    : [{ sku: order.sku, productName: order.product, image: order.productImage, variation: order.variation, qty: order.qty, unitPrice: order.unitPrice }];

  // Carried over unchanged from the previous non-Shopee-style fallback
  // (retired 2026-08-20) — same order.status values, same meaning.
  const isCancelled = order.status === "已取消" || order.status === "退款中";
  const actionable = ACTIONABLE_STATUS.includes(order.status);
  // 取消订单 button visibility (2026-08-20, explicit spec): only shown for
  // early/pre-ship real platform statuses (待处理/待发货/待取货/未付款) —
  // hidden once an order has actually shipped (运输中/已送达/已完成) or is
  // already cancelled/in a return flow. Falls back to hidden for any status
  // not explicitly in the allow-list, which safely covers 运输中/已送达/
  // 已完成/已取消/退货退款/投递失败 without having to enumerate every one.
  const canCancel = !isCancelled && !order.cancelStage && CANCELLABLE_PLATFORM_STATUSES.has(order.platformStatus);
  // Representative item — the same one order.sku/order.skuStatus already
  // describes (see mapDbOrder's `first` — highest-subtotal item). Used only
  // to attach the existing missing/unlinked-SKU warning to the matching row
  // in the item table below; no new SKU-validity logic, just relocating an
  // existing signal into the new layout.
  const repIdx = items.findIndex((it) => it.sku && it.sku === order.sku);

  return (
    <>
      <div className={`flex items-center justify-between px-5 py-4 border-b border-slate-200 ${theme.bgWash}`}>
        <div>
          <div className="text-sm font-semibold flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${theme.dot}`} />
            {order.id}
          </div>
          <div className="text-xs text-slate-400">{order.platform} · {order.date}</div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X size={18} />
        </button>
      </div>

      <div className="p-5 space-y-5">
        {/* 顶部操作按钮 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPrint(order)}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600 font-medium"
          >
            <Printer size={13} /> {isAwaitingShip ? t("安排出货 / 打印订单", "Arrange Shipment / Print") : t("打印订单", "Print Order")}
          </button>
          {onRequestCancel && canCancel && (
            <button
              onClick={() => {
                const reason = window.prompt(t("请输入取消原因", "Enter cancellation reason"));
                if (reason && reason.trim()) onRequestCancel(order.id, reason.trim());
              }}
              className="flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 font-medium"
            >
              {t("取消订单", "Cancel Order")}
            </button>
          )}
        </div>
        {order.cancelStage && (
          <div className="flex items-center gap-2 text-amber-700 text-xs bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            <AlertTriangle size={13} /> {order.cancelStage === "requested" ? t("取消申请中，待确认取消", "Cancellation requested, pending confirmation") : t("此订单已取消", "This order has been cancelled")}
          </div>
        )}
        {isCancelled && (
          <div className="flex items-center gap-2 text-rose-600 text-xs bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
            <AlertTriangle size={13} /> {t(`此订单状态：${statusLabel(order.status, lang)}`, `This order is already ${statusLabel(order.status, lang)}`)}
          </div>
        )}

        {/* 订单流程追踪 — 保留 */}
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

        {/* 客户已收货/需登记退货 — carried over unchanged from the retired fallback */}
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

        {/* 待出货提示区块，或（已出货后）当前状态文字 */}
        {order.shipDeadline ? (
          <div className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-100 text-amber-700 rounded-lg px-3 py-2">
            <Clock size={13} className="shrink-0" />
            {t(`为避免延迟出货，请于 ${order.shipDeadline} 前出货`, `Ship before ${order.shipDeadline} to avoid a late shipment`)}
          </div>
        ) : (
          <div className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 border ${statusColor(order.status)}`}>
            <Info size={13} className="shrink-0" /> {statusLabel(order.status, lang)}
          </div>
        )}

        {/* 订单编号 + 买家收件地址 — 2026-08-20: side-by-side now that the
            drawer is 800px wide, was single-column at the old 420px width */}
        <div className="grid grid-cols-2 gap-6">
          <div className="text-sm">
            <div className="text-xs text-slate-400 mb-1">{t("订单编号", "Order No.")}</div>
            <div className="font-medium tabular-nums">{order.platformOrderId || order.id}</div>
          </div>

          <div className="text-sm">
            <div className="text-xs text-slate-400 mb-1.5 flex items-center gap-1"><MapPin size={12} /> {t("买家收件地址", "Buyer Shipping Address")}</div>
            <div className="text-slate-700 font-medium">{order.customer}</div>
            <div className="text-slate-500">{order.phone}</div>
            <div className="text-slate-500">{order.address}</div>
            {/* Real Shopee API behavior, not local masking — order/get_order_detail
                redacts buyer PII to "****" by default (buyer information
                protection policy); confirmed live 2026-08-20 (1382/1383 synced
                Shopee orders masked, 0/8158 TikTok orders masked). Unmasking
                would need a different Shopee endpoint (shipping-document
                download) — out of scope here per "其他數據算式與API保持不變". */}
            {order.platform === "Shopee" && order.customer === "****" && (
              <div className="text-[11px] text-amber-600 mt-1">{t("⚠ Shopee 隐藏买家信息以保护隐私，需另接打印面单 API 才能显示真实地址", "⚠ Shopee masks buyer info for privacy; real address needs a separate shipping-label API")}</div>
            )}
          </div>
        </div>

        {/* 运送信息 + 买家信息/即时聊天 */}
        <div className="grid grid-cols-2 gap-6 border-t border-slate-100 pt-4">
          <div className="text-sm">
            <div className="text-xs text-slate-400 mb-1.5 flex items-center gap-1"><Truck size={12} /> {t("运送信息", "Shipping Info")}</div>
            <div className="flex justify-between mb-1"><span className="text-slate-500">{t("包裹编号", "Package No.")}</span><span className="tabular-nums">{order.tracking}</span></div>
            <div className="flex justify-between mb-1"><span className="text-slate-500">{t("物流渠道", "Logistics Channel")}</span><span>{order.courier}</span></div>
            <div className="flex justify-between mb-2"><span className="text-slate-500">{t("最新物流状态", "Latest Logistics Status")}</span><span>{statusLabel(order.status, lang)}</span></div>
            <div className="text-slate-500 mb-1.5">{t(`共 ${items.length} 件商品`, `Total ${items.length} product${items.length > 1 ? "s" : ""}`)}</div>
            <div className="flex items-center gap-2 flex-wrap">
              {items.map((it, idx) => (
                <div key={idx} className="relative">
                  {it.image ? (
                    <img src={it.image} alt={it.productName} className="h-10 w-10 rounded-md object-cover border border-slate-200" />
                  ) : (
                    <div className="h-10 w-10 rounded-md bg-slate-100 border border-slate-200" />
                  )}
                  <span className="absolute -bottom-1 -right-1 text-[9px] leading-none bg-slate-900 text-white rounded-full px-1 py-0.5">×{it.qty}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="text-sm">
            <div className="text-xs text-slate-400 mb-1">{t("买家信息", "Buyer Info")}</div>
            <div className="font-medium mb-2">{order.customer}</div>
            <button
              onClick={async () => {
                // Shopee MY Seller Center order detail page (2026-08-20,
                // reverted per explicit request — NOTE: this exact
                // /portal/sale/order/{order_sn} path was the FIRST thing
                // tried for this button and confirmed live by the user to
                // 404. Restored anyway on explicit instruction, without a
                // fresh live re-verification ("沒有實際驗證，只是目前需要這個
                //體驗，希望先試看看") — if it 404s again, buyer_username is
                // still copied to clipboard first as a working fallback
                // (paste into https://seller.shopee.com.my/webchat/conversations,
                // the path already confirmed NOT to 404).
                if (order.platform === "Shopee") {
                  if (order.buyerUsername) {
                    try {
                      await navigator.clipboard.writeText(order.buyerUsername);
                      setChatToast(t(`已复制买家账号 ${order.buyerUsername}，正在打开订单详情页…`, `Copied buyer account ${order.buyerUsername} — opening order detail page…`));
                    } catch {
                      setChatToast(t("复制失败，请手动复制买家账号", "Copy failed — please copy the buyer account manually"));
                    }
                  } else {
                    setChatToast(t("此订单暂无买家账号数据", "No buyer account synced for this order yet"));
                  }
                  setTimeout(() => setChatToast(null), 2500);
                  window.open(`https://seller.shopee.com.my/portal/sale/order/${order.platformOrderId}`, "_blank", "noopener,noreferrer");
                } else {
                  window.alert(t("即时聊天功能暂未开通", "Live chat isn't available yet"));
                }
              }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
            >
              <Send size={13} /> {t("即时聊天", "Live Chat")}
            </button>
            {chatToast && (
              <div className="fixed bottom-6 right-6 z-[60] bg-slate-900 text-white text-xs px-4 py-2.5 rounded-lg shadow-lg max-w-xs">
                {chatToast}
              </div>
            )}
          </div>
        </div>

        {/* 付款信息：商品列表 + 折叠预估收入明细 */}
        <div className="border-t border-slate-100 pt-4 text-sm">
          <div className="text-xs text-slate-400 mb-2 flex items-center gap-1"><CreditCard size={12} /> {t("付款信息", "Payment Info")}</div>
          <div className="space-y-2 mb-2">
            {items.map((it, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                {it.image ? (
                  <img src={it.image} alt={it.productName} className="h-9 w-9 rounded-md object-cover border border-slate-200 shrink-0" />
                ) : (
                  <div className="h-9 w-9 rounded-md bg-slate-100 border border-slate-200 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-slate-700 truncate">{it.productName}</div>
                  <div className="text-slate-400 truncate">
                    {[it.sku, it.variation].filter(Boolean).join(" · ") || "—"}
                    {idx === repIdx && order.skuStatus === "missing" && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-600 border border-rose-200 align-middle">{t("⚠ CSV未填，请补充", "⚠ Missing in CSV, please fill in")}</span>}
                    {idx === repIdx && order.skuStatus === "unlinked" && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 align-middle">{t("⚠ 系统未登记此SKU", "⚠ SKU not registered in system")}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0 text-slate-500 tabular-nums">
                  <div>RM {fmt(num(it.unitPrice))} × {it.qty}</div>
                  <div className="text-slate-700 font-medium">RM {fmt(num(it.unitPrice) * (it.qty || 1))}</div>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => setShowIncomeDetail((v) => !v)}
            className="w-full flex items-center justify-between text-xs text-slate-500 py-1.5 border-t border-slate-100"
          >
            <span>{hasRealData ? t("预估收入明细", "Estimated Income Breakdown") : t("预估收入明细（系统预估）", "Estimated Income Breakdown (system estimate)")}</span>
            <ChevronDown size={14} className={`text-slate-400 transition-transform ${showIncomeDetail ? "rotate-180" : ""}`} />
          </button>
          {showIncomeDetail && (
            settlementLoading ? (
              <div className="text-xs text-slate-300 py-2">{t("加载中…", "Loading…")}</div>
            ) : (
              <div className="pt-2">
                <FeeBreakdownPanel detail={incomeDetail} t={t} isEstimate={!isFinalSettlement} />
              </div>
            )
          )}
        </div>

        {/* 买家实付金额 */}
        {buyerPaymentInfo && (
          <div className="border-t border-slate-100 pt-4 text-sm">
            <button
              onClick={() => setShowPaymentDetail((v) => !v)}
              className="w-full flex items-center justify-between text-xs text-slate-400"
            >
              <span>{t("买家实付金额", "Buyer Total Payment")}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-700 font-semibold tabular-nums">RM {fmt(num(buyerPaymentInfo.buyer_total_amount))}</span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${showPaymentDetail ? "rotate-180" : ""}`} />
              </div>
            </button>
            {showPaymentDetail && (
              <div className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-slate-500">{t("商品总额", "Merchandise Subtotal")}</span><span className="tabular-nums">RM {fmt(num(buyerPaymentInfo.merchant_subtotal))}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">{t("运费", "Shipping Fee")}</span><span className="tabular-nums">RM {fmt(num(buyerPaymentInfo.shipping_fee))}</span></div>
                {num(buyerPaymentInfo.shopee_voucher) !== 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Shopee Voucher</span><span className="tabular-nums text-rose-600">RM {fmt(num(buyerPaymentInfo.shopee_voucher))}</span></div>
                )}
                {num(buyerPaymentInfo.seller_voucher) !== 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Seller Voucher</span><span className="tabular-nums text-rose-600">RM {fmt(num(buyerPaymentInfo.seller_voucher))}</span></div>
                )}
                {num(buyerPaymentInfo.shopee_coins_redeemed) !== 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">{t("Shopee 币折抵", "Shopee Coins")}</span><span className="tabular-nums text-rose-600">- RM {fmt(num(buyerPaymentInfo.shopee_coins_redeemed))}</span></div>
                )}
                {num(buyerPaymentInfo.shipping_fee_sst_amount) !== 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Buyer Paid Shipping Fee SST</span><span className="tabular-nums">RM {fmt(num(buyerPaymentInfo.shipping_fee_sst_amount))}</span></div>
                )}
                <div className="flex justify-between font-semibold pt-1.5 border-t border-slate-100">
                  <span>{t("买家实付总额", "Total Paid by Buyer")}</span>
                  <span className="tabular-nums">RM {fmt(num(buyerPaymentInfo.buyer_total_amount))}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
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

async function fetchStockMovements({ sku, warehouse, movementType } = {}) {
  let query = supabaseClient
    .from("stock_movements")
    .select("id, sku, warehouse, movement_type, qty_change, qty_deducted, stock_before, stock_after, reason, staff_email, order_id, purchase_order_id, purchase_order_item_id, created_at, purchase_orders(po_no)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (sku) query = query.eq("sku", sku);
  if (warehouse) query = query.eq("warehouse", warehouse);
  if (movementType) query = query.eq("movement_type", movementType);
  const { data, error } = await query;
  if (error) { console.error("fetchStockMovements failed", error); return []; }
  return (data || []).map((m) => ({ ...mapDbStockMovement(m), poNo: m.purchase_orders?.po_no || null }));
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
  const [view, setView] = useState("stock"); // "stock" | "ledger"
  const [ledgerInitialSku, setLedgerInitialSku] = useState("");
  const [wh, setWh] = useState("全部");
  const [reservedBySku, setReservedBySku] = useState({});
  const [editingLocationSku, setEditingLocationSku] = useState(null);
  const [locationDraft, setLocationDraft] = useState("");
  const [movementItem, setMovementItem] = useState(null);
  const lang = t("zh", "en");

  function openLedgerFor(sku) {
    setLedgerInitialSku(sku);
    setView("ledger");
  }

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
      <div className="flex gap-2 border-b border-slate-200 pb-2">
        {[["stock", t("库存查询", "Stock Query")], ["ledger", t("库存流水", "Stock Ledger")], ["stocktake", t("盘点", "Stocktake")]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`px-3 py-1.5 text-sm rounded-lg ${view === key ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "ledger" && <StockLedgerView t={t} inventory={inventory} initialSku={ledgerInitialSku} />}
      {view === "stocktake" && <StocktakeView t={t} inventory={inventory} onRecordMovement={onRecordMovement} />}

      {view === "stock" && (
      <>
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
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setMovementItem(item)}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                      >
                        <SlidersHorizontal size={11} /> {t("库存调整", "Adjust")}
                      </button>
                      <button
                        onClick={() => openLedgerFor(item.sku)}
                        className="text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                      >
                        {t("查看流水", "View Ledger")}
                      </button>
                    </div>
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
      </>
      )}
    </div>
  );
}

function StockLedgerView({ t, inventory, initialSku = "" }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [skuFilter, setSkuFilter] = useState(initialSku);
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const lang = t("zh", "en");

  useEffect(() => { setSkuFilter(initialSku); }, [initialSku]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchStockMovements({ sku: skuFilter || undefined, warehouse: warehouseFilter || undefined, movementType: typeFilter || undefined })
      .then((data) => { if (!cancelled) { setRows(data); setLoading(false); } });
    return () => { cancelled = true; };
  }, [skuFilter, warehouseFilter, typeFilter]);

  function typeLabel(row) {
    if (row.movementType === "stock_in" && row.purchaseOrderId) {
      return `${t("PO收货", "PO Receiving")}${row.poNo ? ` (${row.poNo})` : ""}`;
    }
    const l = MOVEMENT_TYPE_LABELS[row.movementType];
    return l ? t(l.zh, l.en) : row.movementType;
  }

  function skuName(sku) {
    return inventory.find((p) => p.sku === sku)?.name || "";
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={skuFilter}
          onChange={(e) => setSkuFilter(e.target.value)}
          placeholder={t("搜索 SKU", "Search SKU")}
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400 max-w-[200px]"
        />
        <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)} className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none bg-white text-slate-600">
          <option value="">{t("全部仓库", "All Warehouses")}</option>
          <option value="A">{t("吉隆坡仓", "KL Warehouse")}</option>
          <option value="B">{t("柔佛仓", "Johor Warehouse")}</option>
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none bg-white text-slate-600">
          <option value="">{t("全部类型", "All Types")}</option>
          {Object.entries(MOVEMENT_TYPE_LABELS).map(([key, l]) => (
            <option key={key} value={key}>{t(l.zh, l.en)}</option>
          ))}
        </select>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                <th className="py-2 pr-3 font-medium">{t("时间", "Time")}</th>
                <th className="py-2 pr-3 font-medium">SKU</th>
                <th className="py-2 pr-3 font-medium">{t("商品名称", "Product Name")}</th>
                <th className="py-2 pr-3 font-medium">{t("类型", "Type")}</th>
                <th className="py-2 pr-3 font-medium">{t("仓库", "Warehouse")}</th>
                <th className="py-2 pr-3 font-medium">{t("数量变化", "Qty Change")}</th>
                <th className="py-2 pr-3 font-medium">{t("变动后", "After")}</th>
                <th className="py-2 pr-3 font-medium">{t("原因/备注", "Reason")}</th>
                <th className="py-2 pr-3 font-medium">{t("经手人", "Staff")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="py-2 pr-3 text-xs text-slate-400 whitespace-nowrap">{new Date(row.createdAt).toLocaleString(lang === "en" ? "en-MY" : "zh-CN")}</td>
                  <td className="py-2 pr-3 font-medium">{row.sku}</td>
                  <td className="py-2 pr-3 text-slate-500">{skuName(row.sku)}</td>
                  <td className="py-2 pr-3">{typeLabel(row)}</td>
                  <td className="py-2 pr-3 text-slate-500">{row.warehouse ? warehouseLabel(row.warehouse, lang) : "—"}</td>
                  <td className={`py-2 pr-3 tabular-nums font-medium ${row.qtyChange < 0 ? "text-rose-600" : "text-emerald-600"}`}>{row.qtyChange > 0 ? `+${row.qtyChange}` : row.qtyChange}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.stockAfter ?? "—"}</td>
                  <td className="py-2 pr-3 text-slate-500">{row.reason || "—"}</td>
                  <td className="py-2 pr-3 text-xs text-slate-400">{row.staffEmail || "—"}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={9} className="py-6 text-center text-slate-400 text-xs">{t("没有符合条件的库存记录", "No matching stock movements")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StocktakeView({ t, inventory, onRecordMovement }) {
  const [warehouse, setWarehouse] = useState("A");
  const [counts, setCounts] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  function setCount(sku, value) {
    setCounts((prev) => ({ ...prev, [sku]: value }));
  }

  const rows = inventory.map((item) => {
    const systemQty = warehouse === "B" ? item.warehouseB : item.warehouseA;
    const countedRaw = counts[item.sku];
    const counted = countedRaw === undefined || countedRaw === "" ? null : Number(countedRaw);
    const variance = counted === null ? null : counted - systemQty;
    return { sku: item.sku, name: item.name, systemQty, counted, variance };
  });

  // Only submit rows staff actually typed a count into, and only if it
  // differs from the system qty — a matching count is a no-op, not worth a
  // ledger entry (mirrors "don't create noise records" from Purchase Order).
  const changedRows = rows.filter((r) => r.counted !== null && r.variance !== 0);

  async function handleSubmit() {
    setSubmitting(true);
    let done = 0, failed = 0;
    for (const row of changedRows) {
      const res = await onRecordMovement?.({ sku: row.sku, movementType: "adjustment", warehouse, targetQty: row.counted, reason: t("盘点", "Stocktake") });
      if (res?.error) failed++; else done++;
    }
    setSubmitting(false);
    setResult({ done, failed });
    setCounts({});
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-500">{t("盘点仓库", "Stocktake Warehouse")}</label>
        <select
          value={warehouse}
          onChange={(e) => { setWarehouse(e.target.value); setCounts({}); setResult(null); }}
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none bg-white text-slate-600"
        >
          <option value="A">{t("吉隆坡仓", "KL Warehouse")}</option>
          <option value="B">{t("柔佛仓", "Johor Warehouse")}</option>
        </select>
        <button
          onClick={handleSubmit}
          disabled={submitting || changedRows.length === 0}
          className={`ml-auto text-sm px-4 py-2 rounded-lg ${changedRows.length > 0 ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}
        >
          {submitting ? t("提交中…", "Submitting…") : t(`确认盘点（${changedRows.length} 项有差异）`, `Confirm Stocktake (${changedRows.length} variance)`)}
        </button>
      </div>

      {result && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border bg-emerald-50 text-emerald-700 border-emerald-200">
          {t(`已提交 ${result.done} 项`, `${result.done} submitted`)}{result.failed > 0 ? t(`，${result.failed} 项失败`, `, ${result.failed} failed`) : ""}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                <th className="py-2 pr-3 font-medium">SKU</th>
                <th className="py-2 pr-3 font-medium">{t("商品名称", "Product Name")}</th>
                <th className="py-2 pr-3 font-medium">{t("系统库存", "System Qty")}</th>
                <th className="py-2 pr-3 font-medium">{t("实盘数量", "Counted Qty")}</th>
                <th className="py-2 pr-3 font-medium">{t("差异", "Variance")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sku} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="py-2 pr-3 font-medium">{row.sku}</td>
                  <td className="py-2 pr-3 text-slate-500">{row.name}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.systemQty}</td>
                  <td className="py-2 pr-3">
                    <input
                      type="number"
                      value={counts[row.sku] ?? ""}
                      onChange={(e) => setCount(row.sku, e.target.value)}
                      placeholder="—"
                      className="w-20 px-2 py-1 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400"
                    />
                  </td>
                  <td className={`py-2 pr-3 tabular-nums font-medium ${row.variance > 0 ? "text-emerald-600" : row.variance < 0 ? "text-rose-600" : "text-slate-300"}`}>
                    {row.variance === null ? "—" : (row.variance > 0 ? `+${row.variance}` : row.variance)}
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
