import { useState } from "react";
import { Plus, Check, X, AlertTriangle, XCircle, SlidersHorizontal, Truck, Wifi, ShoppingBag, Music2, ChevronDown, LogIn, Store, Settings, Pencil } from "lucide-react";
import { supabaseClient, SUPABASE_URL } from "./shared.jsx";
import { PlatformLoginConnect, StoreManagement } from "./pagesMove.jsx";

const STATUS_LABELS = {
  pending: { zh: "待审批", en: "Pending", cls: "bg-amber-50 text-amber-600 border-amber-200" },
  approved: { zh: "已批准", en: "Approved", cls: "bg-emerald-50 text-emerald-600 border-emerald-200" },
  rejected: { zh: "已拒绝", en: "Rejected", cls: "bg-rose-50 text-rose-600 border-rose-200" },
};

const SYNC_LABELS = {
  not_applicable: { zh: "—", en: "—" },
  pending: { zh: "待同步 AutoCount", en: "Pending AutoCount Sync" },
  synced: { zh: "已同步", en: "Synced" },
  failed: { zh: "同步失败", en: "Sync Failed" },
};

function AdjustmentForm({ t, inventory, onCancel, onSave }) {
  const [sku, setSku] = useState("");
  const [qtyChange, setQtyChange] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!sku || !qtyChange || !reason.trim()) {
      setError(t("SKU / 数量 / 原因均为必填", "SKU / quantity / reason are all required"));
      return;
    }
    setSaving(true);
    setError("");
    const result = await onSave({ sku, qtyChange: Number(qtyChange), reason: reason.trim() });
    setSaving(false);
    if (result?.error) setError(result.error);
    else onCancel();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="text-sm font-medium">{t("新增库存调整申请", "New Inventory Adjustment Request")}</div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          {error && (
            <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border bg-rose-50 text-rose-600 border-rose-200">
              <AlertTriangle size={13} /> {error}
            </div>
          )}
          <div>
            <label className="text-[11px] text-slate-400 mb-1 block">SKU</label>
            <select value={sku} onChange={(e) => setSku(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400 bg-white">
              <option value="">{t("选择商品", "Select product")}</option>
              {inventory.map((i) => <option key={i.sku} value={i.sku}>{i.sku} — {i.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-slate-400 mb-1 block">{t("调整数量（正数入库，负数出库）", "Qty Change (+ in, - out)")}</label>
            <input type="number" value={qtyChange} onChange={(e) => setQtyChange(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
          </div>
          <div>
            <label className="text-[11px] text-slate-400 mb-1 block">{t("原因（盘点差异 / 损坏 / 人工修正）", "Reason (count variance / damage / manual correction)")}</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">{t("取消", "Cancel")}</button>
          <button onClick={handleSave} disabled={saving} className="text-xs px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300">
            {saving ? t("提交中…", "Submitting…") : t("提交申请", "Submit Request")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function InventoryAdjustment({ t, lang, inventory, adjustmentRequests, myRole, onCreate, onApprove, onReject, cancellationRecords, onFinalizeCancellation, section }) {
  const [formOpen, setFormOpen] = useState(false);
  const [actionError, setActionError] = useState("");

  async function handleApprove(id) {
    const result = await onApprove(id);
    if (result?.error) setActionError(result.error);
  }
  async function handleReject(id) {
    const result = await onReject(id);
    if (result?.error) setActionError(result.error);
  }
  async function handleFinalize(record) {
    const result = await onFinalizeCancellation(record.id, record.orderNo);
    if (result?.error) setActionError(result.error);
  }

  return (
    <div className="space-y-6">
      {section !== "cancel" && (
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium">{t("库存调整申请（盘点差异 / 损坏 / 人工修正）", "Inventory Adjustment Requests (count variance / damage / manual correction)")}</div>
          <button onClick={() => setFormOpen(true)} className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800">
            <Plus size={14} /> {t("新增申请", "New Request")}
          </button>
        </div>

        {actionError && (
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border bg-rose-50 text-rose-600 border-rose-200 mb-3">
            <AlertTriangle size={13} /> {actionError}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                  <th className="py-2 pr-3 font-medium">SKU</th>
                  <th className="py-2 pr-3 font-medium">{t("数量", "Qty")}</th>
                  <th className="py-2 pr-3 font-medium">{t("原因", "Reason")}</th>
                  <th className="py-2 pr-3 font-medium">{t("申请人", "Requested By")}</th>
                  <th className="py-2 pr-3 font-medium">{t("状态", "Status")}</th>
                  <th className="py-2 pr-3 font-medium">AutoCount</th>
                  <th className="py-2 pr-3 font-medium">{t("操作", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {adjustmentRequests.map((r) => {
                  const status = STATUS_LABELS[r.status] || STATUS_LABELS.pending;
                  return (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="py-2.5 pr-3 font-medium">{r.sku}</td>
                      <td className={`py-2.5 pr-3 ${r.qtyChange >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{r.qtyChange >= 0 ? `+${r.qtyChange}` : r.qtyChange}</td>
                      <td className="py-2.5 pr-3 text-slate-500">{r.reason}</td>
                      <td className="py-2.5 pr-3 text-slate-500">{r.requestedBy || "—"}</td>
                      <td className="py-2.5 pr-3">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${status.cls}`}>{lang === "en" ? status.en : status.zh}</span>
                      </td>
                      <td className="py-2.5 pr-3 text-slate-400 text-xs">{lang === "en" ? SYNC_LABELS[r.autocountSyncStatus]?.en : SYNC_LABELS[r.autocountSyncStatus]?.zh}</td>
                      <td className="py-2.5 pr-3">
                        {r.status === "pending" && myRole === "owner" ? (
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleApprove(r.id)} className="text-emerald-500 hover:text-emerald-700" title={t("批准", "Approve")}><Check size={14} /></button>
                            <button onClick={() => handleReject(r.id)} className="text-rose-500 hover:text-rose-700" title={t("拒绝", "Reject")}><X size={14} /></button>
                          </div>
                        ) : r.status === "pending" ? (
                          <span className="text-[11px] text-slate-300">{t("等待 Owner 审批", "Awaiting owner approval")}</span>
                        ) : (
                          <span className="text-[11px] text-slate-300">{r.approvedBy || "—"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {adjustmentRequests.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-slate-400 text-xs">{t("暂无库存调整申请", "No adjustment requests yet")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      )}

      {section !== "adjust" && (
      <div>
        <div className="text-sm font-medium mb-3">{t("订单取消记录", "Order Cancellation Records")}</div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                  <th className="py-2 pr-3 font-medium">{t("订单号", "Order No.")}</th>
                  <th className="py-2 pr-3 font-medium">{t("渠道", "Channel")}</th>
                  <th className="py-2 pr-3 font-medium">SKU</th>
                  <th className="py-2 pr-3 font-medium">{t("数量", "Qty")}</th>
                  <th className="py-2 pr-3 font-medium">{t("客户", "Customer")}</th>
                  <th className="py-2 pr-3 font-medium">{t("原因", "Reason")}</th>
                  <th className="py-2 pr-3 font-medium">AutoCount DO</th>
                  <th className="py-2 pr-3 font-medium">{t("状态", "Status")}</th>
                  <th className="py-2 pr-3 font-medium">{t("操作", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {cancellationRecords.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="py-2.5 pr-3 font-medium">{r.orderNo}</td>
                    <td className="py-2.5 pr-3 text-slate-500 capitalize">{r.channel}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{r.sku}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{r.qty}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{r.customerName || "—"}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{r.reason}</td>
                    <td className="py-2.5 pr-3 text-slate-400 text-xs">{r.autocountDocNo || t("未传送", "Not sent")}</td>
                    <td className="py-2.5 pr-3">
                      {r.cancelledAt ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full border bg-slate-50 text-slate-500 border-slate-200">{t("已取消", "Cancelled")}</span>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 rounded-full border bg-amber-50 text-amber-600 border-amber-200">{t("取消申请中", "Cancel Requested")}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      {!r.cancelledAt && (
                        <button onClick={() => handleFinalize(r)} className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                          {t("确认取消", "Confirm Cancelled")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {cancellationRecords.length === 0 && (
                  <tr><td colSpan={9} className="py-6 text-center text-slate-400 text-xs">{t("暂无取消记录", "No cancellation records yet")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      )}

      {formOpen && <AdjustmentForm t={t} inventory={inventory} onCancel={() => setFormOpen(false)} onSave={onCreate} />}
    </div>
  );
}

// Hub landing for 自动导入订单: two card entries (订单取消 / 库存调整), each
// broken down by platform (Shopee / TikTok Shop) + connected store name,
// reusing InventoryAdjustment's existing tables via its `section` prop —
// no new tables, no new backend calls, just in-memory filtering of data
// already loaded (stores/inventory/adjustmentRequests/cancellationRecords).
// Landing card style mirrors Order Management Center's status cards
// (ORDER_CENTER_CARDS in pagesOverviewOrders.jsx): icon in a colored circle
// + label + short description, no new visual language introduced.
const HUB_CARDS = [
  { key: "cancel", zh: "订单取消", en: "Order Cancellation", desc: { zh: "按平台/店铺查看与处理取消申请", en: "View / process cancellation requests by platform / store" }, icon: XCircle, iconBg: "bg-rose-100", iconColor: "text-rose-600" },
  { key: "adjust", zh: "库存调整", en: "Inventory Adjustment", desc: { zh: "按平台/店铺提交与审批库存调整", en: "Submit / approve inventory adjustments by platform / store" }, icon: SlidersHorizontal, iconBg: "bg-indigo-100", iconColor: "text-indigo-600" },
  { key: "autocountdo", zh: "AutoCount DO", en: "AutoCount DO", desc: { zh: "按平台/店铺查看待创建 DO 的订单", en: "View orders pending DO creation by platform / store" }, icon: Truck, iconBg: "bg-blue-100", iconColor: "text-blue-600" },
  { key: "connect", zh: "平台/API 连接", en: "Platform / API Connections", desc: { zh: "Shopee / TikTok Shop / AutoCount 连接入口", en: "Shopee / TikTok Shop / AutoCount connection entry points" }, icon: Wifi, iconBg: "bg-emerald-100", iconColor: "text-emerald-600" },
  { key: "login", zh: "使用平台账号登录连接", en: "Connect via Platform Login", desc: { zh: "跳转 Shopee / TikTok Shop 官方登录授权", en: "Redirect to Shopee / TikTok Shop official login authorization" }, icon: LogIn, iconBg: "bg-teal-100", iconColor: "text-teal-600" },
  { key: "storelist", zh: "店铺列表 / 手动导入", en: "Store List / Manual Connect", desc: { zh: "已连接店铺列表、手动连接新店铺", en: "Connected store list, manually connect a new store" }, icon: Store, iconBg: "bg-amber-100", iconColor: "text-amber-600" },
];

// Entry-only shortcuts, no wired functionality yet.
const QUICK_ACTIONS = [
  { zh: "同步 Shopee 订单", en: "Sync Shopee Orders" },
  { zh: "同步 TikTok 订单", en: "Sync TikTok Orders" },
  { zh: "同步 AutoCount 库存", en: "Sync AutoCount Stock" },
  { zh: "导出取消清单", en: "Export Cancellations" },
  { zh: "导出调整清单", en: "Export Adjustments" },
  { zh: "导出 DO 清单", en: "Export DO List" },
  { zh: "打印设置", en: "Print Settings" },
  { zh: "店铺设置", en: "Store Settings" },
  { zh: "系统日志", en: "System Log" },
];

const DEFAULT_BADGE_COLOR = { Shopee: "#f97316", "TikTok Shop": "#111827" };
const FONT_STYLE_OPTIONS = [
  { value: "normal", zh: "常规", en: "Normal" },
  { value: "bold", zh: "粗体", en: "Bold" },
  { value: "italic", zh: "斜体", en: "Italic" },
];

// Store card settings editor — opened via the ⚙️ button on the "店铺列表 /
// 手动导入" screen. Writes platform_accounts.account_name / logo_url /
// font_color / font_style / badge_color / shop_note (via onUpdateStoreName +
// onUpdateStoreAppearance, wired to updateStoreName / updateStoreAppearance
// in erp-mvp-demo.jsx). Purely cosmetic/ERP-display fields — never touches
// token, shop_id, status, hidden, orders, or any sync/cron logic.
function StoreCardSettings({ t, stores, onUpdateStoreName, onUpdateStoreAppearance, onBack }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null); // { name, logoUrl, fontColor, fontStyle, badgeColor, shopNote }

  function startEdit(s) {
    setEditingId(s.id);
    setDraft({
      name: s.name || "",
      logoUrl: s.logoUrl || "",
      fontColor: s.fontColor || "#0f172a",
      fontStyle: s.fontStyle || "normal",
      badgeColor: s.badgeColor || DEFAULT_BADGE_COLOR[s.platform] || "#64748b",
      shopNote: s.shopNote || "",
    });
  }

  function save(id) {
    if (!draft) return;
    const name = draft.name.trim();
    if (name) onUpdateStoreName(id, name);
    onUpdateStoreAppearance(id, {
      logoUrl: draft.logoUrl.trim(),
      fontColor: draft.fontColor,
      fontStyle: draft.fontStyle,
      badgeColor: draft.badgeColor,
      shopNote: draft.shopNote.trim(),
    });
    setEditingId(null);
    setDraft(null);
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-xs text-slate-500 hover:text-slate-700">{t("← 返回", "← Back")}</button>
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        <div className="px-4 py-3 text-sm font-medium">{t("店铺卡片设置", "Store Card Settings")}</div>
        {stores.length === 0 && (
          <div className="px-4 py-6 text-xs text-slate-400 text-center">{t("暂无已连接店铺", "No connected stores")}</div>
        )}
        {stores.map((s) => (
          <div key={s.id} className="px-4 py-3">
            <div className="flex items-center gap-3">
              {s.logoUrl ? (
                <img src={s.logoUrl} alt="" className="h-8 w-8 rounded-full object-cover shrink-0 border border-slate-200" />
              ) : (
                <div className="h-8 w-8 rounded-full bg-slate-100 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate" style={{ color: s.fontColor, fontWeight: s.fontStyle === "bold" ? 700 : 500, fontStyle: s.fontStyle === "italic" ? "italic" : "normal" }}>
                  {s.name}
                </div>
                <div className="text-[11px] text-slate-400">{s.platform} · Shop ID: {s.shopId || "—"}</div>
              </div>
              {editingId !== s.id && (
                <button onClick={() => startEdit(s)} className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1">
                  <Pencil size={12} /> {t("编辑", "Edit")}
                </button>
              )}
            </div>

            {editingId === s.id && draft && (
              <div className="mt-3 pl-11 space-y-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">{t("店铺名称", "Store Name")}</label>
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    autoFocus
                    className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-teal-400"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">{t("圆形 Logo", "Circular Logo")}</label>
                  <div className="flex items-center gap-2">
                    {draft.logoUrl ? (
                      <img src={draft.logoUrl} alt="" className="h-9 w-9 rounded-full object-cover shrink-0 border border-slate-200" />
                    ) : (
                      <div className="h-9 w-9 rounded-full bg-slate-100 shrink-0" />
                    )}
                    <label className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer">
                      {t("选择图片", "Choose Photo")}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () => setDraft((prev) => (prev ? { ...prev, logoUrl: reader.result } : prev));
                          reader.readAsDataURL(file);
                        }}
                        className="hidden"
                      />
                    </label>
                    {draft.logoUrl && (
                      <button onClick={() => setDraft({ ...draft, logoUrl: "" })} className="text-xs text-slate-400 hover:text-rose-500">
                        {t("移除", "Remove")}
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-[11px] text-slate-400 mb-1">{t("名称字体颜色", "Name Font Color")}</label>
                    <input
                      type="color"
                      value={draft.fontColor}
                      onChange={(e) => setDraft({ ...draft, fontColor: e.target.value })}
                      className="h-8 w-full rounded-lg border border-slate-300 cursor-pointer"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[11px] text-slate-400 mb-1">{t("字体风格", "Font Style")}</label>
                    <select
                      value={draft.fontStyle}
                      onChange={(e) => setDraft({ ...draft, fontStyle: e.target.value })}
                      className="w-full h-8 px-2 text-sm border border-slate-300 rounded-lg outline-none focus:border-teal-400"
                    >
                      {FONT_STYLE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{t(o.zh, o.en)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-[11px] text-slate-400 mb-1">{t("专属标签颜色", "Badge Color")}</label>
                    <input
                      type="color"
                      value={draft.badgeColor}
                      onChange={(e) => setDraft({ ...draft, badgeColor: e.target.value })}
                      className="h-8 w-full rounded-lg border border-slate-300 cursor-pointer"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">{t("店铺备忘录", "Shop Note")}</label>
                  <textarea
                    value={draft.shopNote}
                    onChange={(e) => setDraft({ ...draft, shopNote: e.target.value })}
                    placeholder={t("例如：主要卖零件 / 官方旗舰店", "e.g. Mainly sells parts / Official flagship store")}
                    rows={2}
                    className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-lg outline-none focus:border-teal-400 resize-none"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setEditingId(null); setDraft(null); }} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
                    {t("取消", "Cancel")}
                  </button>
                  <button onClick={() => save(s.id)} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 flex items-center gap-1">
                    <Check size={12} /> {t("保存", "Save")}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AutoImportHub({ t, lang, stores, inventory, adjustmentRequests, myRole, onCreate, onApprove, onReject, cancellationRecords, onFinalizeCancellation, orders, goTo, onRefresh, onConnectStore, onSetSyncMode, onUpdateStoreName, onUpdateStoreAppearance, onDisconnectStore, currentUserEmail }) {
  const [card, setCard] = useState(null); // null | "cancel" | "adjust" | "autocountdo" | "connect" | "login" | "storelist" | "storesettings"
  const [platform, setPlatform] = useState("Shopee");
  const [selectedStore, setSelectedStore] = useState(""); // "" = 该平台全部店铺
  const [checkedStoreIds, setCheckedStoreIds] = useState(() => new Set());
  const [syncState, setSyncState] = useState({}); // { [storeId]: { status: "idle"|"syncing"|"success"|"error", lastSyncedAt, message } }

  function toggleStoreChecked(id) {
    setCheckedStoreIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Placeholder sync entry point, keyed by platform_account_id (== store.id
  // here). No real Shopee/TikTok API call yet — just simulates the
  // request/response cycle (syncing -> success). Real integration calls
  // tiktok-sync-orders/shopee-sync-orders with { platformAccountId } in the
  // body; those functions look up platform/shop_id/access_token/refresh_token
  // by that same id — the surrounding UI doesn't need to change when it does.
  async function syncOrders(platformAccountId) {
    setSyncState((prev) => ({ ...prev, [platformAccountId]: { ...prev[platformAccountId], status: "syncing", message: "" } }));
    const store = stores.find((s) => s.id === platformAccountId);
    const fnName = store?.platform === "Shopee" ? "shopee-sync-orders" : "tiktok-sync-orders";
    // tiktok-sync-orders/shopee-sync-orders look this account up by id, pull
    // its own access_token/shop_id from platform_accounts, fetch that shop's
    // orders only, and write them with platform_account_id = this id — so
    // separate stores (even same platform) never mix orders.
    const { error } = await supabaseClient.functions.invoke(fnName, { body: { platformAccountId } });
    if (error) {
      setSyncState((prev) => ({ ...prev, [platformAccountId]: { ...prev[platformAccountId], status: "error", message: error.message || t("同步失败", "Sync failed") } }));
      return;
    }
    setSyncState((prev) => ({
      ...prev,
      [platformAccountId]: { status: "success", lastSyncedAt: new Date().toLocaleString(lang === "en" ? "en-MY" : "zh-CN"), message: t("同步完成", "Sync complete") },
    }));
  }

  // 更新连接 (2026-08-25, new) — reuses the exact same OAuth flow as the
  // original "连接" button (tiktok-auth-start / tiktok-auth-callback):
  // TikTok always returns the same open_id for this app+shop, so the
  // callback matches this shop's existing platform_accounts row and
  // refreshes only its auth columns (access_token/refresh_token/
  // token_expires_at/status) — account_name, historical orders, products,
  // and stock sync relationships are all untouched. ?u= carries the
  // current staff email through so the callback can attribute updated_by.
  function updateConnection() {
    const qs = currentUserEmail ? `?u=${encodeURIComponent(currentUserEmail)}` : "";
    window.open(`${SUPABASE_URL}/functions/v1/tiktok-auth-start${qs}`, "_blank");
  }

  // 退出连接 (2026-08-25, new) — in-app confirm modal (not window.confirm)
  // to match this app's existing styled-confirmation pattern elsewhere;
  // confirm text is the exact wording requested. onDisconnectStore only
  // clears token/session columns (see erp-mvp-demo.jsx's disconnectStore),
  // history stays intact.
  const [disconnectTarget, setDisconnectTarget] = useState(null); // store | null
  function confirmDisconnect() {
    onDisconnectStore?.(disconnectTarget.id);
    setDisconnectTarget(null);
  }

  function syncCheckedStores() {
    checkedStoreIds.forEach((id) => syncOrders(id));
  }

  if (!card) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {HUB_CARDS.map((c) => (
            <button key={c.key} onClick={() => setCard(c.key)} className="text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-400 space-y-2">
              <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${c.iconBg} ${c.iconColor}`}>
                <c.icon size={17} />
              </div>
              <div className="text-sm font-medium">{t(c.zh, c.en)}</div>
              <div className="text-xs text-slate-400">{t(c.desc.zh, c.desc.en)}</div>
            </button>
          ))}
        </div>

        <button
          onClick={syncCheckedStores}
          disabled={checkedStoreIds.size === 0}
          className={`text-xs px-3 py-1.5 rounded-lg ${checkedStoreIds.size > 0 ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}
        >
          {t(`同步选中店铺订单（${checkedStoreIds.size}）`, `Sync Selected Stores (${checkedStoreIds.size})`)}
        </button>

        {["Shopee", "TikTok Shop"].map((pf) => {
          const PfLogo = pf === "Shopee" ? ShoppingBag : Music2;
          const pfStores = stores.filter((s) => s.platform === pf);
          return (
            <div key={pf}>
              <div className="flex items-center gap-2 mb-2">
                <PfLogo size={15} className={pf === "Shopee" ? "text-orange-500" : "text-slate-700"} />
                <div className="text-sm font-medium">{pf}</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {pfStores.length === 0 && (
                  <div className="text-xs text-slate-400">{t("暂无已连接店铺", "No connected stores")}</div>
                )}
                {pfStores.map((s) => {
                  const sync = syncState[s.id] || { status: "idle", lastSyncedAt: null, message: "" };
                  return (
                    <div key={s.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={checkedStoreIds.has(s.id)}
                        onChange={() => toggleStoreChecked(s.id)}
                        className="h-3.5 w-3.5 mt-1 rounded border-slate-300 shrink-0"
                      />
                      {s.logoUrl ? (
                        <img src={s.logoUrl} alt="" className="h-6 w-6 rounded-full object-cover mt-0.5 shrink-0 border border-slate-200" />
                      ) : (
                        <PfLogo size={16} className={`mt-0.5 shrink-0 ${pf === "Shopee" ? "text-orange-500" : "text-slate-700"}`} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <div
                            className="text-sm truncate"
                            style={{ color: s.fontColor || undefined, fontWeight: s.fontStyle === "bold" ? 700 : 500, fontStyle: s.fontStyle === "italic" ? "italic" : "normal" }}
                          >
                            {s.name}
                          </div>
                          <span
                            className="shrink-0 h-2 w-2 rounded-full"
                            style={{ backgroundColor: s.badgeColor || DEFAULT_BADGE_COLOR[pf] || "#64748b" }}
                            title={pf}
                          />
                        </div>
                        <div className="text-[11px] text-slate-400">{pf}</div>
                        <div className="text-[11px] text-slate-400">Shop ID: {s.shopId || "—"}</div>
                        {/* TikTok Shop 连接状态 (2026-08-25, new) — real
                            3-state badge (connected/expired/disconnected),
                            see mapDbStore's connectionStatus. Shopee keeps
                            the old plain "已连接" text unchanged. */}
                        {pf === "TikTok Shop" ? (
                          <div className={`text-[11px] ${s.connectionStatus === "disconnected" ? "text-slate-400" : s.connectionStatus === "expired" ? "text-amber-600" : "text-emerald-600"}`}>
                            {s.connectionStatus === "disconnected" ? t("已退出连接", "Disconnected") : s.connectionStatus === "expired" ? t("连接已过期，请更新连接", "Connection expired — please update") : t("已连接", "Connected")}
                          </div>
                        ) : (
                          <div className="text-[11px] text-emerald-600">{s.status}</div>
                        )}
                        <div className="text-[11px] text-slate-400">{t("订单数量：0", "Orders: 0")}</div>
                        <div className="text-[11px] text-slate-400">{t("最后同步：", "Last sync: ")}{sync.lastSyncedAt || t("从未同步", "Never")}</div>
                        {s.shopNote && <div className="text-[11px] text-slate-500 mt-1 italic truncate">{s.shopNote}</div>}
                        {sync.status === "syncing" && <div className="text-[11px] text-blue-500 mt-1">{t("同步中…", "Syncing…")}</div>}
                        {sync.status === "success" && <div className="text-[11px] text-emerald-600 mt-1">{sync.message}</div>}
                        {sync.status === "error" && <div className="text-[11px] text-rose-600 mt-1">{sync.message}</div>}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          <button
                            onClick={() => syncOrders(s.id)}
                            disabled={sync.status === "syncing"}
                            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {sync.status === "syncing" ? t("同步中…", "Syncing…") : t("同步订单", "Sync")}
                          </button>
                          {/* 更新连接 / 退出连接 (2026-08-25, new) — TikTok
                              Shop only, per explicit request; Shopee's card
                              is untouched. */}
                          {pf === "TikTok Shop" && (
                            <>
                              <button
                                onClick={updateConnection}
                                className="text-xs px-2.5 py-1.5 rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                              >
                                {t("更新连接", "Update Connection")}
                              </button>
                              {s.connectionStatus !== "disconnected" && (
                                <button
                                  onClick={() => setDisconnectTarget(s)}
                                  className="text-xs px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50"
                                >
                                  {t("退出连接", "Disconnect")}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
          {QUICK_ACTIONS.map((label) => (
            <button key={label.zh} onClick={() => {}} className="text-[11px] px-2 py-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 text-center">
              {t(label.zh, label.en)}
            </button>
          ))}
        </div>

        {/* 退出连接确认 (2026-08-25, new) — exact requested wording. */}
        {disconnectTarget && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDisconnectTarget(null)}>
            <div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
              <div className="text-sm font-medium text-rose-700">{t("确定要退出此 TikTok Shop 连接吗？", "Disconnect this TikTok Shop connection?")}</div>
              <div className="text-xs text-slate-500">
                {t("退出后将停止自动同步订单，但历史数据会保留。", "Auto order sync will stop, but historical data is kept.")}
              </div>
              <div className="text-xs text-slate-400">{t("店铺：", "Store: ")}{disconnectTarget.name}</div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setDisconnectTarget(null)} className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">{t("取消", "Cancel")}</button>
                <button onClick={confirmDisconnect} className="text-sm px-4 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-700">{t("确认退出", "Disconnect")}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (card === "login") {
    return (
      <div className="space-y-4">
        <button onClick={() => setCard(null)} className="text-xs text-slate-500 hover:text-slate-700">{t("← 返回", "← Back")}</button>
        <PlatformLoginConnect t={t} stores={stores} onRefresh={onRefresh} />
      </div>
    );
  }

  if (card === "storelist") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setCard(null)} className="text-xs text-slate-500 hover:text-slate-700">{t("← 返回", "← Back")}</button>
          <button
            onClick={() => setCard("storesettings")}
            title={t("店铺名称设置", "Store Name Settings")}
            className="h-7 w-7 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
          >
            <Settings size={14} />
          </button>
        </div>
        <StoreManagement t={t} stores={stores} onConnect={onConnectStore} onSetSyncMode={onSetSyncMode} onRefresh={onRefresh} />
      </div>
    );
  }

  if (card === "storesettings") {
    return (
      <StoreCardSettings
        t={t}
        stores={stores}
        onUpdateStoreName={onUpdateStoreName}
        onUpdateStoreAppearance={onUpdateStoreAppearance}
        onBack={() => setCard("storelist")}
      />
    );
  }

  if (card === "connect") {
    const CONNECT_ROWS = [
      { zh: "Shopee API", en: "Shopee API", connected: stores.some((s) => s.platform === "Shopee") },
      { zh: "TikTok Shop API", en: "TikTok Shop API", connected: stores.some((s) => s.platform === "TikTok Shop") },
      { zh: "AutoCount API", en: "AutoCount API", connected: false },
    ];
    return (
      <div className="space-y-4">
        <button onClick={() => setCard(null)} className="text-xs text-slate-500 hover:text-slate-700">{t("← 返回", "← Back")}</button>
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {CONNECT_ROWS.map((row) => (
            <div key={row.zh} className="flex items-center justify-between px-4 py-3">
              <div className="text-sm">{t(row.zh, row.en)}</div>
              <span className={`text-xs ${row.connected ? "text-emerald-600" : "text-slate-400"}`}>
                {row.connected ? t("已连接（见「使用平台账号登录连接」卡片）", "Connected (see “Connect via Platform Login” card)") : t("尚未接入", "Not yet connected")}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const platforms = ["Shopee", "TikTok Shop"];
  const dbPlatform = platform === "Shopee" ? "shopee" : "tiktok";
  const platformStores = stores.filter((s) => s.platform === platform);
  const visibleStores = selectedStore ? platformStores.filter((s) => s.id === selectedStore) : platformStores;
  const filteredCancellations = cancellationRecords.filter((r) => r.channel === dbPlatform);
  const shopIds = new Set(visibleStores.map((s) => s.id));
  const platformSkus = new Set(inventory.filter((i) => shopIds.has(i.listedShop)).map((i) => i.sku));
  const filteredAdjustments = adjustmentRequests.filter((r) => platformSkus.has(r.sku));

  return (
    <div className="space-y-4">
      <button onClick={() => setCard(null)} className="text-xs text-slate-500 hover:text-slate-700">{t("← 返回", "← Back")}</button>
      <div className="flex items-center gap-3">
        {platforms.map((p) => {
          const PfLogo = p === "Shopee" ? ShoppingBag : Music2;
          const active = platform === p;
          return (
            <button
              key={p}
              onClick={() => { setPlatform(p); setSelectedStore(""); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                active ? (p === "Shopee" ? "bg-orange-500 border-orange-500 text-white" : "bg-slate-900 border-slate-900 text-white") : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
              }`}
            >
              <PfLogo size={15} className={active ? "text-white" : p === "Shopee" ? "text-orange-500" : "text-slate-700"} />
              {p}
            </button>
          );
        })}
        <div className="relative">
          <select
            value={selectedStore}
            onChange={(e) => setSelectedStore(e.target.value)}
            className="appearance-none text-xs border border-slate-200 rounded-lg pl-3 pr-7 py-2 bg-white text-slate-600 outline-none"
          >
            <option value="">{t("全部店铺", "All Stores")}</option>
            {platformStores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>
      </div>
      <div className="text-xs text-slate-400">
        {t("店铺：", "Stores: ")}{visibleStores.length > 0 ? visibleStores.map((s) => s.name).join("、") : t("暂无已连接店铺", "No connected stores")}
      </div>
      {card === "autocountdo" ? (
        <div className="space-y-3">
          {visibleStores.length === 0 && (
            <div className="text-xs text-slate-400">{t("暂无已连接店铺", "No connected stores")}</div>
          )}
          {visibleStores.map((s) => {
            const pendingDoOrders = (orders || []).filter(
              (o) => o.platformAccountId === s.id && (o.printCount || 0) > 0 && o.status !== "已取消",
            );
            return (
              <div key={s.id} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium">{s.name}</div>
                  <span className="text-xs text-slate-400">{t(`待创建 DO：${pendingDoOrders.length} 笔`, `Pending DO: ${pendingDoOrders.length}`)}</span>
                </div>
                <div className="space-y-2 mb-3">
                  {pendingDoOrders.length === 0 && (
                    <div className="text-xs text-slate-400">{t("暂无待创建 DO 的订单", "No orders pending DO creation")}</div>
                  )}
                  {pendingDoOrders.map((o) => (
                    <div key={o.id} className="flex items-center gap-2 border border-slate-100 rounded-lg p-2">
                      {o.productImage ? (
                        <img src={o.productImage} alt={o.product} className="h-9 w-9 rounded-lg object-cover border border-slate-200 shrink-0" />
                      ) : (
                        <div className="h-9 w-9 rounded-lg bg-slate-100 border border-slate-200 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="text-xs font-medium text-slate-700 truncate">{o.id}</div>
                          <span className="text-[10px] text-slate-400 shrink-0">{o.date}</span>
                        </div>
                        <div className="text-[11px] text-slate-600 truncate">{o.product}</div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {o.variation ? `${o.variation} · ` : ""}{t("Seller SKU", "Seller SKU")}: {o.sku || t("（无SKU）", "(no SKU)")} · {s.name}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => {}}
                  disabled={pendingDoOrders.length === 0}
                  title={t("预留：调用 AutoCount 创建 DO 接口", "Placeholder: call AutoCount Create DO API")}
                  className={`text-xs px-3 py-1.5 rounded-lg ${pendingDoOrders.length > 0 ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}
                >
                  {t("创建 DO", "Create DO")}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <InventoryAdjustment
          t={t}
          lang={lang}
          inventory={inventory}
          adjustmentRequests={card === "adjust" ? filteredAdjustments : []}
          myRole={myRole}
          onCreate={onCreate}
          onApprove={onApprove}
          onReject={onReject}
          cancellationRecords={card === "cancel" ? filteredCancellations : []}
          onFinalizeCancellation={onFinalizeCancellation}
          section={card}
        />
      )}
    </div>
  );
}
