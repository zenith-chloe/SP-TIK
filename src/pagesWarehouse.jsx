import { useState } from "react";
import { Printer, PackageOpen, PackageCheck, Box, Boxes, Truck, Clock, AlertTriangle } from "lucide-react";
import { KPICard } from "./pagesOverviewOrders.jsx";

// Display labels for orders.warehouse_stage — independent from
// DB_TO_DEMO_STATUS (which describes order_status, the platform-driven
// field). See erp-mvp-demo.jsx's handlePrintConfirm/markPicked/markPacked
// for how this field gets written; TikTok/Shopee sync never touches it.
const STAGE_LABELS = {
  pending: { zh: "待处理", en: "Pending", icon: Clock, tone: "bg-slate-400" },
  printed: { zh: "已打印", en: "Printed", icon: Printer, tone: "bg-sky-500" },
  picking: { zh: "拣货中", en: "Picking", icon: PackageOpen, tone: "bg-amber-400" },
  picked: { zh: "已拣货", en: "Picked", icon: PackageCheck, tone: "bg-amber-500" },
  packing: { zh: "包装中", en: "Packing", icon: Box, tone: "bg-indigo-400" },
  packed: { zh: "已包装", en: "Packed", icon: Boxes, tone: "bg-indigo-500" },
  ready_ship: { zh: "等待出货", en: "Ready to Ship", icon: Truck, tone: "bg-emerald-500" },
};
const STAGE_ORDER = ["pending", "printed", "picking", "picked", "packing", "packed", "ready_ship"];
// Orders still actively moving through the warehouse pipeline today —
// ready_ship/cancelled/etc. don't need daily attention on this list.
const ACTIVE_STAGES = ["pending", "printed", "picked"];

export function Warehouse({ t, orders, onPrint, onMarkPicked, onMarkPacked }) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const lang = t("zh", "en");
  const today = new Date().toISOString().slice(0, 10);

  const todayOrders = orders.filter((o) => o.date === today);
  const countsByStage = STAGE_ORDER.reduce((acc, stage) => {
    acc[stage] = todayOrders.filter((o) => (o.warehouseStage || "pending") === stage).length;
    return acc;
  }, {});

  const activeOrders = orders
    .filter((o) => ACTIVE_STAGES.includes(o.warehouseStage || "pending"))
    .sort((a, b) => a.date.localeCompare(b.date));

  const selectedOrders = activeOrders.filter((o) => selectedIds.has(o.id));
  const pickableCount = selectedOrders.filter((o) => o.warehouseStage === "printed").length;
  const packableCount = selectedOrders.filter((o) => o.warehouseStage === "picked").length;
  const allChecked = activeOrders.length > 0 && activeOrders.every((o) => selectedIds.has(o.id));

  function toggle(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelectedIds((prev) => (allChecked ? new Set() : new Set(activeOrders.map((o) => o.id))));
  }

  function handlePrintSelected() {
    if (selectedOrders.length === 0) return;
    onPrint?.(selectedOrders);
  }
  function handlePickedSelected() {
    if (pickableCount === 0) return;
    onMarkPicked?.(selectedOrders.filter((o) => o.warehouseStage === "printed").map((o) => o.id));
    setSelectedIds(new Set());
  }
  function handlePackedSelected() {
    if (packableCount === 0) return;
    onMarkPacked?.(selectedOrders.filter((o) => o.warehouseStage === "picked").map((o) => o.id));
    setSelectedIds(new Set());
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-medium mb-3">{t("今日订单进度", "Today's Order Progress")}</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {STAGE_ORDER.map((stage) => {
            const s = STAGE_LABELS[stage];
            return (
              <KPICard key={stage} label={lang === "en" ? s.en : s.zh} value={countsByStage[stage]} icon={s.icon} tone={s.tone} />
            );
          })}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium">{t("仓库作业订单（待处理/已打印/已拣货）", "Warehouse Queue (Pending / Printed / Picked)")}</div>
          <span className="text-xs text-slate-400">{t(`共 ${activeOrders.length} 笔`, `${activeOrders.length} order(s)`)}</span>
        </div>

        <div className="flex items-center gap-3 mb-3">
          <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-3.5 w-3.5 rounded border-slate-300" />
            {t("全选订单", "Select All")}
          </label>
          <span className="text-xs text-slate-400">{t(`已选 ${selectedOrders.length} 笔`, `${selectedOrders.length} selected`)}</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handlePrintSelected}
              disabled={selectedOrders.length === 0}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg ${selectedOrders.length > 0 ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}
            >
              <Printer size={13} /> {t(`批量打印 Label（${selectedOrders.length}）`, `Batch Print Label (${selectedOrders.length})`)}
            </button>
            <button
              onClick={handlePickedSelected}
              disabled={pickableCount === 0}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg ${pickableCount > 0 ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}
            >
              <PackageCheck size={13} /> {t(`批量拣货完成（${pickableCount}）`, `Batch Mark Picked (${pickableCount})`)}
            </button>
            <button
              onClick={handlePackedSelected}
              disabled={packableCount === 0}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg ${packableCount > 0 ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}
            >
              <Truck size={13} /> {t(`批量包装完成（${packableCount}）`, `Batch Mark Packed (${packableCount})`)}
            </button>
          </div>
        </div>

        {(pickableCount < selectedOrders.length || packableCount < selectedOrders.length) && selectedOrders.length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-600 mb-2">
            <AlertTriangle size={11} />
            {t("部分已选订单当前阶段不适用该操作，会自动跳过", "Some selected orders aren't at the right stage for an action and will be skipped")}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                <th className="py-2 pr-3 pl-1 font-medium w-8"></th>
                <th className="py-2 pr-3 font-medium">{t("订单编号", "Order No.")}</th>
                <th className="py-2 pr-3 font-medium">{t("客户", "Customer")}</th>
                <th className="py-2 pr-3 font-medium">{t("阶段", "Stage")}</th>
                <th className="py-2 pr-3 font-medium">{t("最近打印", "Last Printed")}</th>
              </tr>
            </thead>
            <tbody>
              {activeOrders.map((o) => {
                const stage = STAGE_LABELS[o.warehouseStage || "pending"];
                return (
                  <tr key={o.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-3 pl-1">
                      <input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggle(o.id)} className="h-3.5 w-3.5 rounded border-slate-300" />
                    </td>
                    <td className="py-2 pr-3 font-medium">{o.id}</td>
                    <td className="py-2 pr-3 text-slate-500">{o.customer}</td>
                    <td className="py-2 pr-3">
                      <span className="text-xs px-2 py-0.5 rounded-full border bg-slate-50 text-slate-600 border-slate-200 inline-flex items-center gap-1">
                        <stage.icon size={11} /> {lang === "en" ? stage.en : stage.zh}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-slate-400">
                      {o.lastPrintedAt ? `${new Date(o.lastPrintedAt).toLocaleString(lang === "en" ? "en-MY" : "zh-CN")}${o.lastPrintedBy ? ` (${o.lastPrintedBy})` : ""}` : "—"}
                    </td>
                  </tr>
                );
              })}
              {activeOrders.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400 text-xs">{t("目前没有需要处理的订单", "No orders need attention right now")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
