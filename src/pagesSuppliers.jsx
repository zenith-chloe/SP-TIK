import { useState } from "react";
import { Plus, Pencil, Trash2, X, Search, AlertTriangle, Ban, CheckCircle2 } from "lucide-react";

const emptyForm = {
  name: "", contactPerson: "", phone: "", email: "", address: "", paymentTerms: "", notes: "", status: "active",
};

function SupplierForm({ t, mode, initial, onCancel, onSave }) {
  const [form, setForm] = useState(initial || emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError(t("供应商名称为必填", "Supplier name is required"));
      return;
    }
    setSaving(true);
    setError("");
    const result = await onSave({
      name: form.name.trim(),
      contactPerson: form.contactPerson.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      paymentTerms: form.paymentTerms.trim(),
      notes: form.notes.trim(),
      status: form.status,
    });
    setSaving(false);
    if (result?.error) setError(result.error);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <div className="text-sm font-medium">{mode === "create" ? t("新增供应商", "New Supplier") : t("编辑供应商", "Edit Supplier")}</div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">
          {error && (
            <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border bg-rose-50 text-rose-600 border-rose-200">
              <AlertTriangle size={13} /> {error}
            </div>
          )}
          <div>
            <label className="text-[11px] text-slate-400 mb-1 block">{t("供应商名称", "Supplier Name")}</label>
            <input value={form.name} onChange={(e) => setField("name", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">{t("联系人", "Contact Person")}</label>
              <input value={form.contactPerson} onChange={(e) => setField("contactPerson", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">{t("电话", "Phone")}</label>
              <input value={form.phone} onChange={(e) => setField("phone", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-slate-400 mb-1 block">Email</label>
            <input value={form.email} onChange={(e) => setField("email", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
          </div>
          <div>
            <label className="text-[11px] text-slate-400 mb-1 block">{t("地址", "Address")}</label>
            <input value={form.address} onChange={(e) => setField("address", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">{t("付款条件", "Payment Terms")}</label>
              <input value={form.paymentTerms} onChange={(e) => setField("paymentTerms", e.target.value)} placeholder={t("例：NET 30", "e.g. NET 30")} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 mb-1 block">{t("状态", "Status")}</label>
              <select value={form.status} onChange={(e) => setField("status", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400 bg-white">
                <option value="active">{t("启用", "Active")}</option>
                <option value="inactive">{t("停用", "Inactive")}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-slate-400 mb-1 block">{t("备注", "Notes")}</label>
            <input value={form.notes} onChange={(e) => setField("notes", e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400" />
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

export function SupplierMaster({ t, suppliers, onCreate, onUpdate, onDelete }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [formState, setFormState] = useState(null); // null | { mode: "create" } | { mode: "edit", item }
  const [actionError, setActionError] = useState("");

  const filtered = suppliers.filter((s) => {
    const q = query.trim().toLowerCase();
    const matchesQuery = !q || [s.name, s.contactPerson, s.phone, s.email].some((v) => (v || "").toLowerCase().includes(q));
    const matchesStatus = statusFilter === "all" || (s.status || "active") === statusFilter;
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

  async function handleToggleStatus(item) {
    const nextStatus = item.status === "inactive" ? "active" : "inactive";
    const result = await onUpdate(item.id, { status: nextStatus });
    if (result?.error) setActionError(`${item.name}: ${result.error}`);
  }

  async function handleDelete(item) {
    if (!window.confirm(t(`确定要删除供应商 ${item.name} 吗？此操作不可撤销。`, `Delete supplier ${item.name}? This cannot be undone.`))) return;
    const result = await onDelete(item.id);
    if (result?.error) setActionError(`${item.name}: ${result.error}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("搜索名称 / 联系人 / 电话 / Email", "Search name / contact / phone / email")}
            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400"
          />
        </div>
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
          <Plus size={14} /> {t("新增供应商", "New Supplier")}
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
                <th className="py-2 pr-3 font-medium">{t("供应商名称", "Supplier Name")}</th>
                <th className="py-2 pr-3 font-medium">{t("联系人", "Contact Person")}</th>
                <th className="py-2 pr-3 font-medium">{t("电话", "Phone")}</th>
                <th className="py-2 pr-3 font-medium">Email</th>
                <th className="py-2 pr-3 font-medium">{t("付款条件", "Payment Terms")}</th>
                <th className="py-2 pr-3 font-medium">{t("状态", "Status")}</th>
                <th className="py-2 pr-3 font-medium">{t("操作", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="py-2.5 pr-3 font-medium">{item.name}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{item.contactPerson || "—"}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{item.phone || "—"}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{item.email || "—"}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{item.paymentTerms || "—"}</td>
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
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-400 text-xs">{t("没有符合条件的供应商", "No matching suppliers")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {formState && (
        <SupplierForm
          t={t}
          mode={formState.mode}
          initial={
            formState.mode === "edit"
              ? {
                  name: formState.item.name, contactPerson: formState.item.contactPerson || "", phone: formState.item.phone || "",
                  email: formState.item.email || "", address: formState.item.address || "", paymentTerms: formState.item.paymentTerms || "",
                  notes: formState.item.notes || "", status: formState.item.status || "active",
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
