import { useState } from "react";
import { Plus, Pencil, Trash2, X, Search, AlertTriangle, Package } from "lucide-react";

// Product Master — internal SKU catalog (name/price/weight/unit/image), kept
// deliberately separate from Inventory (warehouse stock levels/locations)
// and ProductMove (warehouse-to-warehouse transfers). This is the future
// anchor point for connecting real TikTok Shop / Shopee product catalogs —
// no platform-linking fields exist yet, this only manages the internal SKU
// identity and its master attributes, using the existing products table
// as-is (no schema changes).
const emptyForm = { sku: "", name: "", price: "", weightKg: "", unit: "", imageUrl: "", initialStock: "" };

function ProductForm({ t, mode, initial, onCancel, onSave }) {
  const [form, setForm] = useState(initial || emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!form.sku.trim() || !form.name.trim()) {
      setError(t("SKU 和商品名称为必填", "SKU and product name are required"));
      return;
    }
    setSaving(true);
    setError("");
    const result = await onSave({
      sku: form.sku.trim(),
      name: form.name.trim(),
      price: Number(form.price) || 0,
      weightKg: Number(form.weightKg) || 0,
      unit: form.unit.trim(),
      imageUrl: form.imageUrl.trim(),
      initialStock: Number(form.initialStock) || 0,
    });
    setSaving(false);
    if (result?.error) setError(result.error);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="text-sm font-medium">{mode === "create" ? t("新增商品", "New Product") : t("编辑商品", "Edit Product")}</div>
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
            <input
              value={form.sku}
              onChange={(e) => setField("sku", e.target.value)}
              disabled={mode === "edit"}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400 disabled:bg-slate-50 disabled:text-slate-400"
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-400 mb-1 block">{t("商品名称", "Product Name")}</label>
            <input value={form.name} onChange={(e) => setField("name", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">{t("价格 (RM)", "Price (RM)")}</label>
              <input type="number" value={form.price} onChange={(e) => setField("price", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">{t("重量 (kg)", "Weight (kg)")}</label>
              <input type="number" value={form.weightKg} onChange={(e) => setField("weightKg", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-slate-400 mb-1 block">{t("单位（例：件/箱）", "Unit (e.g. pcs/box)")}</label>
            <input value={form.unit} onChange={(e) => setField("unit", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
          </div>
          <div>
            <label className="text-[11px] text-slate-400 mb-1 block">{t("图片链接", "Image URL")}</label>
            <input value={form.imageUrl} onChange={(e) => setField("imageUrl", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
          </div>
          {mode === "create" && (
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">{t("起始库存（吉隆坡仓）", "Starting Stock (KL Warehouse)")}</label>
              <input type="number" value={form.initialStock} onChange={(e) => setField("initialStock", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
              <div className="text-[11px] text-slate-400 mt-1">{t("之后要调库存/搬仓，请到「库存管理」或「产品搬仓」页面操作", "To adjust stock later, use Inventory or Stock Transfer instead")}</div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200">
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

export function ProductMaster({ t, inventory, onCreate, onUpdate, onDelete }) {
  const [query, setQuery] = useState("");
  const [formState, setFormState] = useState(null); // null | { mode: "create" } | { mode: "edit", item }
  const [deleteError, setDeleteError] = useState("");

  const filtered = query.trim()
    ? inventory.filter((p) => p.sku.toLowerCase().includes(query.toLowerCase()) || p.name.toLowerCase().includes(query.toLowerCase()))
    : inventory;

  async function handleSave(values) {
    if (formState.mode === "create") {
      const result = await onCreate(values);
      if (!result?.error) setFormState(null);
      return result;
    }
    const result = await onUpdate(formState.item.sku, values);
    if (!result?.error) setFormState(null);
    return result;
  }

  async function handleDelete(item) {
    if (!window.confirm(t(`确定要删除 ${item.sku} 吗？此操作不可撤销。`, `Delete ${item.sku}? This cannot be undone.`))) return;
    const result = await onDelete(item.sku);
    if (result?.error) setDeleteError(`${item.sku}: ${result.error}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("搜索 SKU / 商品名称", "Search SKU / product name")}
            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400"
          />
        </div>
        <button
          onClick={() => setFormState({ mode: "create" })}
          className="ml-auto flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
        >
          <Plus size={14} /> {t("新增商品", "New Product")}
        </button>
      </div>

      {deleteError && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border bg-rose-50 text-rose-600 border-rose-200">
          <AlertTriangle size={13} /> {deleteError}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                <th className="py-2 pr-3 font-medium w-12"></th>
                <th className="py-2 pr-3 font-medium">SKU</th>
                <th className="py-2 pr-3 font-medium">{t("商品名称", "Product Name")}</th>
                <th className="py-2 pr-3 font-medium">{t("价格", "Price")}</th>
                <th className="py-2 pr-3 font-medium">{t("重量", "Weight")}</th>
                <th className="py-2 pr-3 font-medium">{t("单位", "Unit")}</th>
                <th className="py-2 pr-3 font-medium">{t("总库存", "Total Stock")}</th>
                <th className="py-2 pr-3 font-medium">{t("操作", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.sku} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="py-2.5 pr-3">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.sku} className="h-8 w-8 object-cover rounded border border-slate-200" />
                    ) : (
                      <div className="h-8 w-8 rounded border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300">
                        <Package size={14} />
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 font-medium">{item.sku}</td>
                  <td className="py-2.5 pr-3">{item.name}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{item.price ? `RM ${item.price.toFixed(2)}` : "—"}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{item.weightKg ? `${item.weightKg} kg` : "—"}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{item.unit || "—"}</td>
                  <td className="py-2.5 pr-3 tabular-nums font-medium">{item.warehouseA + item.warehouseB}</td>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setFormState({ mode: "edit", item })} className="text-slate-400 hover:text-slate-700" title={t("编辑", "Edit")}>
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleDelete(item)} className="text-slate-400 hover:text-rose-600" title={t("删除", "Delete")}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-400 text-xs">{t("没有符合条件的商品", "No matching products")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {formState && (
        <ProductForm
          t={t}
          mode={formState.mode}
          initial={
            formState.mode === "edit"
              ? { sku: formState.item.sku, name: formState.item.name, price: String(formState.item.price || ""), weightKg: String(formState.item.weightKg || ""), unit: formState.item.unit || "", imageUrl: formState.item.imageUrl || "", initialStock: "" }
              : undefined
          }
          onCancel={() => setFormState(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
