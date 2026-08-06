import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, X, Search, AlertTriangle, Package2 } from "lucide-react";
import { supabaseClient } from "./shared.jsx";

async function fetchReceivedQtyByItem(purchaseOrderId) {
  const { data, error } = await supabaseClient
    .from("stock_movements")
    .select("purchase_order_item_id, qty_change")
    .eq("purchase_order_id", purchaseOrderId)
    .eq("movement_type", "stock_in");
  if (error) { console.error("fetchReceivedQtyByItem failed", error); return {}; }
  const byItem = {};
  (data || []).forEach((row) => {
    byItem[row.purchase_order_item_id] = (byItem[row.purchase_order_item_id] || 0) + (row.qty_change || 0);
  });
  return byItem;
}

const STATUS_LABEL = {
  draft: ["草稿", "Draft"],
  ordered: ["已下单", "Ordered"],
  received: ["已收货", "Received"],
  cancelled: ["已取消", "Cancelled"],
};

const STATUS_BADGE_CLASS = {
  draft: "bg-slate-50 text-slate-500 border-slate-200",
  ordered: "bg-amber-50 text-amber-600 border-amber-200",
  received: "bg-emerald-50 text-emerald-600 border-emerald-200",
  cancelled: "bg-rose-50 text-rose-500 border-rose-200",
};

function emptyItem() {
  return { _key: crypto.randomUUID(), productId: "", sku: "", productName: "", qty: 1, unitCost: 0 };
}

// Suggests "PO-YYYYMMDD-00N" from today's date + how many POs already exist
// with that prefix — pure client-side, no DB sequence/trigger. Still just a
// pre-filled starting value in an editable field, not an enforced format.
function generatePoNo(purchaseOrders) {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const prefix = `PO-${ymd}-`;
  const todayCount = purchaseOrders.filter((po) => po.poNo?.startsWith(prefix)).length;
  return `${prefix}${String(todayCount + 1).padStart(3, "0")}`;
}

function emptyForm(poNo = "") {
  return { poNo, supplierId: "", orderDate: new Date().toISOString().slice(0, 10), expectedDate: "", notes: "", items: [emptyItem()] };
}

function PurchaseOrderForm({ t, mode, initial, suppliers, products, onCancel, onSave }) {
  const [form, setForm] = useState(initial || emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // New POs can only pick active suppliers/products; an already-saved PO
  // keeps showing whatever it was created with even if that supplier/product
  // has since been set inactive, so its history stays intact.
  const activeSuppliers = suppliers.filter((s) => s.status !== "inactive" || s.id === form.supplierId);
  const activeProducts = products.filter((p) => p.status !== "inactive" || form.items.some((it) => it.productId === p.id));

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setItemField(key, field, value) {
    setForm((prev) => ({ ...prev, items: prev.items.map((it) => (it._key === key ? { ...it, [field]: value } : it)) }));
  }

  function addItem() {
    setForm((prev) => ({ ...prev, items: [...prev.items, emptyItem()] }));
  }

  function removeItem(key) {
    setForm((prev) => ({ ...prev, items: prev.items.filter((it) => it._key !== key) }));
  }

  const total = form.items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unitCost) || 0), 0);

  async function handleSave() {
    if (!form.poNo.trim() || !form.supplierId) {
      setError(t("PO 编号和供应商为必填", "PO No. and supplier are required"));
      return;
    }
    const validItems = form.items.filter((it) => it.productId);
    if (validItems.length === 0) {
      setError(t("请至少选择一个商品", "Please select at least one product"));
      return;
    }
    const supplier = suppliers.find((s) => s.id === form.supplierId);
    setSaving(true);
    setError("");
    const result = await onSave({
      poNo: form.poNo.trim(),
      supplierId: form.supplierId,
      supplierName: supplier?.name || "",
      orderDate: form.orderDate,
      expectedDate: form.expectedDate,
      notes: form.notes.trim(),
      items: validItems.map((it) => ({
        productId: it.productId,
        sku: it.sku,
        productName: it.productName,
        qty: Number(it.qty) || 0,
        unitCost: Number(it.unitCost) || 0,
      })),
    });
    setSaving(false);
    if (result?.error) setError(result.error);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <div className="text-sm font-medium">{mode === "create" ? t("新增采购订单", "New Purchase Order") : t("编辑采购订单", "Edit Purchase Order")}</div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">
          {error && (
            <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border bg-rose-50 text-rose-600 border-rose-200">
              <AlertTriangle size={13} /> {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">PO No.</label>
              <input value={form.poNo} onChange={(e) => setField("poNo", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">{t("供应商", "Supplier")}</label>
              <select value={form.supplierId} onChange={(e) => setField("supplierId", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400 bg-white">
                <option value="">{t("请选择", "Select…")}</option>
                {activeSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">{t("下单日期", "Order Date")}</label>
              <input type="date" value={form.orderDate} onChange={(e) => setField("orderDate", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">{t("预计到货日", "Expected Date")}</label>
              <input type="date" value={form.expectedDate} onChange={(e) => setField("expectedDate", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-slate-400 mb-1 block">{t("备注", "Notes")}</label>
            <input value={form.notes} onChange={(e) => setField("notes", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
          </div>

          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] text-slate-400">{t("商品明细", "Line Items")}</label>
              <button onClick={addItem} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
                <Plus size={12} /> {t("新增行", "Add Item")}
              </button>
            </div>
            <div className="space-y-2">
              {form.items.map((it) => {
                // Search narrows the <select>'s own option list (native
                // element, not a custom widget) — the picker still only ever
                // accepts a real product as its value, search is purely a
                // filter on top, not a free-text alternative to it.
                const q = (it._search || "").trim().toLowerCase();
                const filteredProducts = activeProducts.filter((p) => (
                  p.id === it.productId || !q || p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
                ));
                return (
                  <div key={it._key} className="flex items-center gap-2 border border-slate-200 rounded-lg p-2">
                    <input
                      value={it._search || ""}
                      onChange={(e) => setItemField(it._key, "_search", e.target.value)}
                      placeholder={t("搜索 SKU/名称", "Search SKU/name")}
                      className="w-28 px-2 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-slate-400"
                    />
                    <select
                      value={it.productId}
                      onChange={(e) => {
                        const productId = e.target.value;
                        const product = products.find((p) => p.id === productId);
                        setForm((prev) => ({
                          ...prev,
                          items: prev.items.map((row) => (row._key === it._key
                            ? { ...row, productId, sku: product?.sku || "", productName: product?.name || "", unitCost: product?.costPrice || 0 }
                            : row)),
                        }));
                      }}
                      className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400 bg-white"
                    >
                      <option value="">{t("选择商品", "Select product…")}</option>
                      {filteredProducts.map((p) => (
                        <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>
                      ))}
                    </select>
                    <input value={it.sku || ""} disabled className="w-24 px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 text-slate-400" title={t("SKU（自动带出，不可编辑）", "SKU (auto-filled, read-only)")} />
                    <input
                      type="number"
                      value={it.qty}
                      onChange={(e) => setItemField(it._key, "qty", e.target.value)}
                      placeholder={t("数量", "Qty")}
                      className="w-16 px-2 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400"
                    />
                    <input
                      type="number"
                      value={it.unitCost}
                      onChange={(e) => setItemField(it._key, "unitCost", e.target.value)}
                      placeholder={t("单价", "Unit Cost")}
                      className="w-20 px-2 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400"
                    />
                    <div className="w-20 text-xs text-slate-500 tabular-nums text-right">RM {((Number(it.qty) || 0) * (Number(it.unitCost) || 0)).toFixed(2)}</div>
                    <button onClick={() => removeItem(it._key)} className="text-slate-300 hover:text-rose-600"><Trash2 size={14} /></button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 text-sm pt-2 border-t border-slate-100">
            <span className="text-slate-400">{t("总金额", "Total Amount")}:</span>
            <span className="font-medium">RM {total.toFixed(2)}</span>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 shrink-0">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">{t("取消", "Cancel")}</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300"
          >
            {saving ? t("保存中…", "Saving…") : t("保存", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReceivingForm({ t, po, onCancel, onSubmit }) {
  const [receivedByItem, setReceivedByItem] = useState({});
  const [loading, setLoading] = useState(true);
  const [warehouse, setWarehouse] = useState("A");
  const [qtyByItem, setQtyByItem] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchReceivedQtyByItem(po.id).then((byItem) => {
      if (cancelled) return;
      setReceivedByItem(byItem);
      const initialQty = {};
      po.items.forEach((it) => {
        const already = byItem[it.id] || 0;
        initialQty[it.id] = Math.max(it.qty - already, 0);
      });
      setQtyByItem(initialQty);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [po.id]);

  function setQty(itemId, value) {
    setQtyByItem((prev) => ({ ...prev, [itemId]: value }));
  }

  async function handleSubmit() {
    const lines = po.items
      .map((it) => ({ purchaseOrderItemId: it.id, productId: it.productId, sku: it.sku, qty: Number(qtyByItem[it.id]) || 0 }))
      .filter((l) => l.qty > 0);
    if (lines.length === 0) {
      setError(t("请至少填写一项收货数量", "Please enter at least one receiving quantity"));
      return;
    }
    setSaving(true);
    setError("");
    const result = await onSubmit({ purchaseOrderId: po.id, warehouse, lines });
    setSaving(false);
    if (result?.error) setError(result.error); else onCancel();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <div className="text-sm font-medium">{t("登记收货", "Register Receipt")} · {po.poNo}</div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">
          {error && (
            <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border bg-rose-50 text-rose-600 border-rose-200">
              <AlertTriangle size={13} /> {error}
            </div>
          )}
          <div>
            <label className="text-[11px] text-slate-400 mb-1 block">{t("入库仓库", "Receiving Warehouse")}</label>
            <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400 bg-white">
              <option value="A">{t("吉隆坡仓", "KL Warehouse")}</option>
              <option value="B">{t("柔佛仓", "Johor Warehouse")}</option>
            </select>
          </div>
          {loading ? (
            <div className="text-xs text-slate-400 py-4 text-center">{t("加载中…", "Loading…")}</div>
          ) : (
            <div className="space-y-2">
              {po.items.map((it) => {
                const already = receivedByItem[it.id] || 0;
                const remaining = Math.max(it.qty - already, 0);
                return (
                  <div key={it.id} className="border border-slate-200 rounded-lg p-2 space-y-1">
                    <div className="text-sm font-medium">{it.productName} <span className="text-slate-400 font-normal">({it.sku})</span></div>
                    <div className="text-[11px] text-slate-400">{t(`订购 ${it.qty} / 已收 ${already} / 剩余 ${remaining}`, `Ordered ${it.qty} / Received ${already} / Remaining ${remaining}`)}</div>
                    <input
                      type="number"
                      value={qtyByItem[it.id] ?? ""}
                      onChange={(e) => setQty(it.id, e.target.value)}
                      placeholder={t("本次收货数量", "Qty to receive now")}
                      className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 shrink-0">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">{t("取消", "Cancel")}</button>
          <button onClick={handleSubmit} disabled={saving || loading} className="text-xs px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300">
            {saving ? t("提交中…", "Submitting…") : t("确认收货", "Confirm Receipt")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PurchaseOrderList({ t, purchaseOrders, suppliers, products, onCreate, onUpdate, onUpdateStatus, onDelete, onReceive }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [formState, setFormState] = useState(null); // null | { mode: "create" } | { mode: "edit", item }
  const [actionError, setActionError] = useState("");
  const [receivingPo, setReceivingPo] = useState(null);

  const filtered = purchaseOrders.filter((po) => {
    const q = query.trim().toLowerCase();
    const matchesQuery = !q || [po.poNo, po.supplierName].some((v) => (v || "").toLowerCase().includes(q));
    const matchesStatus = statusFilter === "all" || po.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  async function handleSave(values) {
    if (formState.mode === "create") {
      const result = await onCreate(values);
      if (!result?.error) setFormState(null);
      return result;
    }
    const result = await onUpdate(formState.item.id, values);
    if (!result?.error) setFormState(null);
    return result;
  }

  async function handleStatusChange(po, status) {
    if (status === "received" && !window.confirm(t(`确认已收到 ${po.poNo} 的全部货物？此操作不会影响库存。`, `Confirm all goods for ${po.poNo} have been received? This will not affect stock.`))) return;
    const result = await onUpdateStatus(po.id, status);
    if (result?.error) setActionError(`${po.poNo}: ${result.error}`);
  }

  async function handleDelete(po) {
    if (!window.confirm(t(`确定要删除采购单 ${po.poNo} 吗？此操作不可撤销。`, `Delete purchase order ${po.poNo}? This cannot be undone.`))) return;
    const result = await onDelete(po.id);
    if (result?.error) setActionError(`${po.poNo}: ${result.error}`);
  }

  function editInitial(po) {
    return {
      poNo: po.poNo,
      supplierId: po.supplierId,
      orderDate: po.orderDate,
      expectedDate: po.expectedDate || "",
      notes: po.notes || "",
      items: po.items.length > 0
        ? po.items.map((it) => ({ _key: crypto.randomUUID(), productId: it.productId, sku: it.sku, productName: it.productName, qty: it.qty, unitCost: it.unitCost }))
        : [emptyItem()],
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("搜索 PO 编号 / 供应商", "Search PO No. / supplier")}
            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-slate-400 bg-white text-slate-600"
        >
          <option value="all">{t("全部状态", "All Status")}</option>
          {Object.entries(STATUS_LABEL).map(([key, [zh, en]]) => (
            <option key={key} value={key}>{t(zh, en)}</option>
          ))}
        </select>
        <button
          onClick={() => setFormState({ mode: "create" })}
          className="ml-auto flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
        >
          <Plus size={14} /> {t("新增采购订单", "New Purchase Order")}
        </button>
      </div>

      {actionError && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border bg-rose-50 text-rose-600 border-rose-200">
          <AlertTriangle size={13} /> {actionError}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                <th className="py-2 pr-3 font-medium">PO No.</th>
                <th className="py-2 pr-3 font-medium">{t("供应商", "Supplier")}</th>
                <th className="py-2 pr-3 font-medium">{t("下单日期", "Order Date")}</th>
                <th className="py-2 pr-3 font-medium">{t("预计到货", "Expected")}</th>
                <th className="py-2 pr-3 font-medium">{t("总金额", "Total")}</th>
                <th className="py-2 pr-3 font-medium">{t("状态", "Status")}</th>
                <th className="py-2 pr-3 font-medium">{t("操作", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((po) => (
                <tr key={po.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="py-2.5 pr-3 font-medium">{po.poNo}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{po.supplierName}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{po.orderDate || "—"}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{po.expectedDate || "—"}</td>
                  <td className="py-2.5 pr-3 tabular-nums font-medium">RM {po.totalAmount.toFixed(2)}</td>
                  <td className="py-2.5 pr-3">
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_BADGE_CLASS[po.status]}`}
                      title={po.status === "received" ? t("库存未自动增加，如需入库请到「库存管理」手动处理", "Stock was not added automatically — use Inventory to record stock-in manually") : undefined}
                    >
                      {t(...STATUS_LABEL[po.status])}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      {po.status === "draft" && (
                        <>
                          <button onClick={() => setFormState({ mode: "edit", item: po })} className="text-slate-400 hover:text-slate-700" title={t("编辑", "Edit")}>
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => handleStatusChange(po, "ordered")} className="text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">{t("标记已下单", "Mark Ordered")}</button>
                          <button onClick={() => handleDelete(po)} className="text-slate-400 hover:text-rose-600" title={t("删除", "Delete")}>
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                      {po.status === "ordered" && (
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <button onClick={() => setReceivingPo(po)} className="text-xs px-2 py-1 rounded-lg border border-sky-200 text-sky-600 hover:bg-sky-50">{t("登记收货", "Register Receipt")}</button>
                            <button onClick={() => handleStatusChange(po, "received")} className="text-xs px-2 py-1 rounded-lg border border-emerald-200 text-emerald-600 hover:bg-emerald-50">{t("标记已收货", "Mark Received")}</button>
                            <button onClick={() => handleStatusChange(po, "cancelled")} className="text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">{t("取消", "Cancel")}</button>
                          </div>
                          <span className="text-[10px] text-slate-400">{t("「标记已收货」只是状态标签；库存增加请用「登记收货」", "\"Mark Received\" is a label only — use \"Register Receipt\" to actually add stock")}</span>
                        </div>
                      )}
                      {po.status === "received" && (
                        <div className="flex items-center gap-2">
                          <button onClick={() => setReceivingPo(po)} className="text-xs px-2 py-1 rounded-lg border border-sky-200 text-sky-600 hover:bg-sky-50">{t("登记收货", "Register Receipt")}</button>
                          <span className="text-[11px] text-slate-300">{t("历史记录，仅供查看", "Historical record, view only")}</span>
                        </div>
                      )}
                      {po.status === "cancelled" && (
                        <span className="text-[11px] text-slate-300">{t("历史记录，仅供查看", "Historical record, view only")}</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-400 text-xs">
                    <div className="flex flex-col items-center gap-1">
                      <Package2 size={18} className="text-slate-300" />
                      {t("没有符合条件的采购订单", "No matching purchase orders")}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {formState && (
        <PurchaseOrderForm
          t={t}
          mode={formState.mode}
          initial={formState.mode === "edit" ? editInitial(formState.item) : emptyForm(generatePoNo(purchaseOrders))}
          suppliers={suppliers}
          products={products}
          onCancel={() => setFormState(null)}
          onSave={handleSave}
        />
      )}

      {receivingPo && (
        <ReceivingForm
          t={t}
          po={receivingPo}
          onCancel={() => setReceivingPo(null)}
          onSubmit={onReceive}
        />
      )}
    </div>
  );
}
