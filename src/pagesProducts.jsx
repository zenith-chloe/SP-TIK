import { useState } from "react";
import { Plus, Pencil, Trash2, X, Search, AlertTriangle, Package, Ban, CheckCircle2 } from "lucide-react";

// Product Master — internal SKU catalog (name/price/weight/unit/image), kept
// deliberately separate from Inventory (warehouse stock levels/locations)
// and ProductMove (warehouse-to-warehouse transfers). This is the future
// anchor point for connecting real TikTok Shop / Shopee product catalogs —
// no platform-linking fields exist yet, this only manages the internal SKU
// identity and its master attributes, using the existing products table
// as-is (no schema changes).
const emptyForm = {
  sku: "", name: "", price: "", weightKg: "", unit: "", imageUrl: "", initialStock: "",
  category: "", brand: "", partNumber: "", barcode: "", costPrice: "", status: "active", autocountItemCode: "",
};

function ProductForm({ t, mode, initial, existingSkus, onCancel, onSave }) {
  const [form, setForm] = useState(initial || emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const profit = (Number(form.price) || 0) - (Number(form.costPrice) || 0);
  const margin = Number(form.price) > 0 ? (profit / Number(form.price)) * 100 : 0;

  async function handleSave() {
    const trimmedSku = form.sku.trim();
    if (!trimmedSku || !form.name.trim()) {
      setError(t("SKU 和商品名称为必填", "SKU and product name are required"));
      return;
    }
    if (mode === "create" && existingSkus?.includes(trimmedSku)) {
      setError(t("SKU 已存在，请使用其他 SKU", "This SKU already exists — please use a different one"));
      return;
    }
    setSaving(true);
    setError("");
    const result = await onSave({
      sku: trimmedSku,
      name: form.name.trim(),
      price: Number(form.price) || 0,
      weightKg: Number(form.weightKg) || 0,
      unit: form.unit.trim(),
      imageUrl: form.imageUrl.trim(),
      initialStock: Number(form.initialStock) || 0,
      category: form.category.trim(),
      brand: form.brand.trim(),
      partNumber: form.partNumber.trim(),
      barcode: form.barcode.trim(),
      costPrice: Number(form.costPrice) || 0,
      status: form.status,
      autocountItemCode: form.autocountItemCode.trim(),
    });
    setSaving(false);
    if (result?.error) setError(result.error);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <div className="text-sm font-medium">{mode === "create" ? t("新增商品", "New Product") : t("编辑商品", "Edit Product")}</div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">
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
              <label className="text-[11px] text-slate-400 mb-1 block">{t("分类", "Category")}</label>
              <input value={form.category} onChange={(e) => setField("category", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">{t("品牌", "Brand")}</label>
              <input value={form.brand} onChange={(e) => setField("brand", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">{t("零件号", "Part Number")}</label>
              <input value={form.partNumber} onChange={(e) => setField("partNumber", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">{t("条形码", "Barcode")}</label>
              <input value={form.barcode} onChange={(e) => setField("barcode", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
            </div>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">{t("成本价 (RM)", "Cost Price (RM)")}</label>
              <input type="number" value={form.costPrice} onChange={(e) => setField("costPrice", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">{t("状态", "Status")}</label>
              <select value={form.status} onChange={(e) => setField("status", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400 bg-white">
                <option value="active">{t("启用", "Active")}</option>
                <option value="inactive">{t("停用", "Inactive")}</option>
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
            <span>{t("利润", "Profit")}: <span className={profit < 0 ? "text-rose-500" : "text-slate-600"}>RM {profit.toFixed(2)}</span></span>
            <span>{t("毛利率", "Margin")}: <span className={margin < 0 ? "text-rose-500" : "text-slate-600"}>{margin.toFixed(1)}%</span></span>
          </div>
          <div>
            <label className="text-[11px] text-slate-400 mb-1 block">AutoCount Item Code</label>
            <input value={form.autocountItemCode} onChange={(e) => setField("autocountItemCode", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
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

export function ProductMaster({ t, inventory, onCreate, onUpdate, onDelete }) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [formState, setFormState] = useState(null); // null | { mode: "create" } | { mode: "edit", item }
  const [actionError, setActionError] = useState("");
  const [selectedSkus, setSelectedSkus] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  const categories = Array.from(new Set(inventory.map((p) => p.category).filter(Boolean))).sort();
  const brands = Array.from(new Set(inventory.map((p) => p.brand).filter(Boolean))).sort();

  const filtered = inventory.filter((p) => {
    const q = query.trim().toLowerCase();
    const matchesQuery = !q || [p.sku, p.name, p.brand, p.category, p.partNumber].some((v) => (v || "").toLowerCase().includes(q));
    const matchesCategory = categoryFilter === "all" || p.category === categoryFilter;
    const matchesBrand = brandFilter === "all" || p.brand === brandFilter;
    const matchesStatus = statusFilter === "all" || (p.status || "active") === statusFilter;
    return matchesQuery && matchesCategory && matchesBrand && matchesStatus;
  });

  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selectedSkus.includes(p.sku));

  function toggleSelectAll() {
    setSelectedSkus(allFilteredSelected ? [] : filtered.map((p) => p.sku));
  }

  function toggleSelectOne(sku) {
    setSelectedSkus((prev) => (prev.includes(sku) ? prev.filter((s) => s !== sku) : [...prev, sku]));
  }

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

  async function handleToggleStatus(item) {
    const nextStatus = item.status === "inactive" ? "active" : "inactive";
    const result = await onUpdate(item.sku, { status: nextStatus });
    if (result?.error) setActionError(`${item.sku}: ${result.error}`);
  }

  async function handleBulkStatus(nextStatus) {
    setBulkBusy(true);
    setActionError("");
    const results = await Promise.all(selectedSkus.map((sku) => onUpdate(sku, { status: nextStatus })));
    const failed = results.filter((r) => r?.error);
    if (failed.length) setActionError(t(`${failed.length} 项更新失败`, `${failed.length} item(s) failed to update`));
    setSelectedSkus([]);
    setBulkBusy(false);
  }

  async function handleDelete(item) {
    if (!window.confirm(t(`确定要删除 ${item.sku} 吗？此操作不可撤销。`, `Delete ${item.sku}? This cannot be undone.`))) return;
    const result = await onDelete(item.sku);
    if (result?.error) setActionError(`${item.sku}: ${result.error}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("搜索 SKU / 名称 / 品牌 / 分类 / 零件号", "Search SKU / name / brand / category / part no.")}
            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="text-sm px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-slate-400 bg-white text-slate-600"
        >
          <option value="all">{t("全部分类", "All Categories")}</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
          className="text-sm px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-slate-400 bg-white text-slate-600"
        >
          <option value="all">{t("全部品牌", "All Brands")}</option>
          {brands.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-slate-400 bg-white text-slate-600"
        >
          <option value="all">{t("全部状态", "All Status")}</option>
          <option value="active">{t("启用", "Active")}</option>
          <option value="inactive">{t("停用", "Inactive")}</option>
        </select>
        <button
          onClick={() => setFormState({ mode: "create" })}
          className="ml-auto flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
        >
          <Plus size={14} /> {t("新增商品", "New Product")}
        </button>
      </div>

      {actionError && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border bg-rose-50 text-rose-600 border-rose-200">
          <AlertTriangle size={13} /> {actionError}
        </div>
      )}

      {selectedSkus.length > 0 && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border bg-slate-50 text-slate-500 border-slate-200">
          <span>{t(`已选择 ${selectedSkus.length} 项`, `${selectedSkus.length} selected`)}</span>
          <button disabled={bulkBusy} onClick={() => handleBulkStatus("active")} className="ml-auto px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-50">{t("批量启用", "Bulk Active")}</button>
          <button disabled={bulkBusy} onClick={() => handleBulkStatus("inactive")} className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-50">{t("批量停用", "Bulk Inactive")}</button>
          <button disabled={bulkBusy} onClick={() => setSelectedSkus([])} className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-400 hover:bg-white disabled:opacity-50">{t("取消选择", "Clear")}</button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1440px]">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                <th className="py-2 pr-3 font-medium w-8">
                  <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} />
                </th>
                <th className="py-2 pr-3 font-medium w-12"></th>
                <th className="py-2 pr-3 font-medium">SKU</th>
                <th className="py-2 pr-3 font-medium">{t("商品名称", "Product Name")}</th>
                <th className="py-2 pr-3 font-medium">{t("分类", "Category")}</th>
                <th className="py-2 pr-3 font-medium">{t("品牌", "Brand")}</th>
                <th className="py-2 pr-3 font-medium">{t("零件号", "Part Number")}</th>
                <th className="py-2 pr-3 font-medium">AutoCount Code</th>
                <th className="py-2 pr-3 font-medium">{t("售价", "Selling Price")}</th>
                <th className="py-2 pr-3 font-medium">{t("成本价", "Cost Price")}</th>
                <th className="py-2 pr-3 font-medium">{t("利润", "Profit")}</th>
                <th className="py-2 pr-3 font-medium">{t("毛利率", "Margin")}</th>
                <th className="py-2 pr-3 font-medium">{t("重量", "Weight")}</th>
                <th className="py-2 pr-3 font-medium">{t("单位", "Unit")}</th>
                <th className="py-2 pr-3 font-medium">{t("总库存", "Total Stock")}</th>
                <th className="py-2 pr-3 font-medium">{t("状态", "Status")}</th>
                <th className="py-2 pr-3 font-medium">{t("操作", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const profit = (item.price || 0) - (item.costPrice || 0);
                const margin = item.price > 0 ? (profit / item.price) * 100 : 0;
                return (
                <tr key={item.sku} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="py-2.5 pr-3">
                    <input type="checkbox" checked={selectedSkus.includes(item.sku)} onChange={() => toggleSelectOne(item.sku)} />
                  </td>
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
                  <td className="py-2.5 pr-3 text-slate-500">{item.category || "—"}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{item.brand || "—"}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{item.partNumber || "—"}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{item.autocountItemCode || "—"}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{item.price ? `RM ${item.price.toFixed(2)}` : "—"}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{item.costPrice ? `RM ${item.costPrice.toFixed(2)}` : "—"}</td>
                  <td className={`py-2.5 pr-3 tabular-nums ${profit < 0 ? "text-rose-500" : ""}`}>{item.price || item.costPrice ? `RM ${profit.toFixed(2)}` : "—"}</td>
                  <td className={`py-2.5 pr-3 tabular-nums ${margin < 0 ? "text-rose-500" : ""}`}>{item.price ? `${margin.toFixed(1)}%` : "—"}</td>
                  <td className="py-2.5 pr-3 tabular-nums">{item.weightKg ? `${item.weightKg} kg` : "—"}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{item.unit || "—"}</td>
                  <td className="py-2.5 pr-3 tabular-nums font-medium">{item.warehouseA + item.warehouseB}</td>
                  <td className="py-2.5 pr-3">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${item.status === "inactive" ? "bg-slate-50 text-slate-400 border-slate-200" : "bg-emerald-50 text-emerald-600 border-emerald-200"}`}>
                      {item.status === "inactive" ? t("停用", "Inactive") : t("启用", "Active")}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setFormState({ mode: "edit", item })} className="text-slate-400 hover:text-slate-700" title={t("编辑", "Edit")}>
                        <Pencil size={14} />
                      </button>
                      {item.status === "inactive" ? (
                        <button onClick={() => handleToggleStatus(item)} className="text-slate-400 hover:text-emerald-600" title={t("设为启用", "Set Active")}>
                          <CheckCircle2 size={14} />
                        </button>
                      ) : (
                        <button onClick={() => handleToggleStatus(item)} className="text-slate-400 hover:text-amber-600" title={t("设为停用", "Set Inactive")}>
                          <Ban size={14} />
                        </button>
                      )}
                      <button onClick={() => handleDelete(item)} className="text-slate-400 hover:text-rose-600" title={t("删除", "Delete")}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={17} className="py-6 text-center text-slate-400 text-xs">{t("没有符合条件的商品", "No matching products")}</td>
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
          existingSkus={inventory.map((p) => p.sku)}
          initial={
            formState.mode === "edit"
              ? {
                  sku: formState.item.sku, name: formState.item.name, price: String(formState.item.price || ""), weightKg: String(formState.item.weightKg || ""), unit: formState.item.unit || "", imageUrl: formState.item.imageUrl || "", initialStock: "",
                  category: formState.item.category || "", brand: formState.item.brand || "", partNumber: formState.item.partNumber || "",
                  barcode: formState.item.barcode || "", costPrice: String(formState.item.costPrice || ""), status: formState.item.status || "active",
                  autocountItemCode: formState.item.autocountItemCode || "",
                }
              : undefined
          }
          onCancel={() => setFormState(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
