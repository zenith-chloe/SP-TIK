import { useState, Fragment as FragmentRows } from "react";
import { Plus, Pencil, Trash2, X, Search, AlertTriangle, Package, Ban, CheckCircle2, Download, ChevronDown, ChevronRight } from "lucide-react";
import { supabaseClient } from "./shared.jsx";

// Product Master — internal SKU catalog (name/price/weight/unit/image), kept
// deliberately separate from Inventory (warehouse stock levels/locations)
// and ProductMove (warehouse-to-warehouse transfers). This is the future
// anchor point for connecting real TikTok Shop / Shopee product catalogs —
// no platform-linking fields exist yet, this only manages the internal SKU
// identity and its master attributes, using the existing products table
// as-is (no schema changes).
// TikTok Product -> Variant grouping (2026-09-28). tiktok-sync-products
// stores each imported TikTok SKU as one products row with
// platform_sync_id = tiktok_<product_id>_<sku_id>; the parent product is
// ONLY ever that real TikTok product_id — never name / SKU similarity.
// Rows without that shape (manual ERP products) stay standalone rows.
const TIKTOK_SYNC_ID = /^tiktok_(\d+)_(\d+)$/;
function tiktokIdsOf(item) {
  const m = TIKTOK_SYNC_ID.exec(item.platformSyncId || "");
  return m ? { productId: m[1], skuId: m[2] } : null;
}

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

export function ProductMaster({ t, inventory, onCreate, onUpdate, onDelete, stores }) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [formState, setFormState] = useState(null); // null | { mode: "create" } | { mode: "edit", item }
  const [actionError, setActionError] = useState("");
  const [selectedSkus, setSelectedSkus] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  // 同步店铺商品 (2026-09-07, new)
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [selectedSyncStore, setSelectedSyncStore] = useState(null);

  async function syncStoreProducts() {
    if (!selectedSyncStore) return;
    setSyncLoading(true);
    setActionError("");
    try {
      const { data: platformAccount, error: acctErr } = await supabaseClient
        .from("platform_accounts").select("*").eq("id", selectedSyncStore).single();
      if (acctErr || !platformAccount) throw new Error("Store not found");

      // Check access token
      if (!platformAccount.access_token && !platformAccount.refresh_token) {
        throw new Error(`❌ ${platformAccount.account_name || "Store"}: 缺少访问令牌 / Missing access token. 请在【店铺管理】重新授权 / Please re-authorize in Store Management.`);
      }

      let products = [];

      if (platformAccount.platform === "shopee") {
        console.log("Fetching Shopee products for shop:", platformAccount.shop_id);

        try {
          const response = await supabaseClient.functions.invoke("shopee-sync-products", {
            body: { platformAccountId: selectedSyncStore, limit: 50 }
          });

          console.log("Edge Function response:", response);
          console.log("Shopee sync full data:", JSON.stringify(response.data, null, 2));

          const syncData = response.data;
          const syncErr = response.error;

          if (syncErr) throw new Error(`API error: ${syncErr.message}`);
          if (!syncData) throw new Error("No data returned");

          products = syncData?.products || [];
          if (products.length === 0) {
            console.log("No products found in Shopee store");
          }
        } catch (invokeErr) {
          console.error("Shopee API sync failed:", invokeErr);
          console.error("Full error object:", JSON.stringify(invokeErr, null, 2));
          const errorMsg = invokeErr?.message || invokeErr?.toString?.() || String(invokeErr);
          throw new Error(`Shopee sync error: ${errorMsg}`);
        }
      } else if (platformAccount.platform === "tiktok") {
        console.log("Fetching TikTok products for shop:", platformAccount.shop_id);

        try {
          const response = await supabaseClient.functions.invoke("tiktok-sync-products", {
            body: { platformAccountId: selectedSyncStore, limit: 50 }
          });

          console.log("Edge Function response:", response);

          const syncData = response.data;
          const syncErr = response.error;

          // Always HTTP 200, check success flag
          if (!syncData.success) {
            const errorMsg = syncData.message || "Unknown error";
            console.error("TikTok sync failed:", errorMsg);
            window.alert(`❌ Sync failed:\n\n${errorMsg}`);
            throw new Error(errorMsg);
          }

          if (!syncData) throw new Error("No data returned");

          products = syncData?.products || [];
          if (products.length === 0) {
            console.log("No products found in TikTok store");
          }
        } catch (invokeErr) {
          console.error("TikTok API sync failed:", invokeErr);
          console.error("Full error object:", JSON.stringify(invokeErr, null, 2));
          const errorMsg = invokeErr?.message || invokeErr?.toString?.() || String(invokeErr);
          throw new Error(`TikTok sync error: ${errorMsg}`);
        }
      } else {
        throw new Error("Platform not supported");
      }

      let importCount = 0;
      for (const p of products) {
        if (!p.sku || !p.title) continue;
        await supabaseClient.from("products").upsert({
          name: p.title || p.item_name, sku: p.sku, price: p.price || 0,
          platform_sync_id: `${platformAccount.platform}_${p.id}`, platform: platformAccount.platform,
        }, { onConflict: "platform_sync_id" });
        importCount++;
      }

      if (importCount === 0) {
        setActionError(`ℹ️ 该店铺暂无可同步的商品 / No products to import`);
        setTimeout(() => setShowSyncModal(false), 1500);
        return;
      }

      setActionError(`✅ 已导入 ${importCount} 件商品 / Imported ${importCount} products`);

      // 重新加载整个库存列表以显示新导入的商品
      console.log("Reloading inventory after sync...");
      const { data: allProducts, error: loadErr } = await supabaseClient
        .from("products").select("*").order("created_at", { ascending: false });
      if (!loadErr && allProducts) {
        console.log("Loaded products from DB:", allProducts.length);
        onCreate?.(); // 触发刷新
      }

      setTimeout(() => setShowSyncModal(false), 1500);
    } catch (err) {
      console.error("syncStoreProducts error:", err);
      setActionError(`❌ ${err.message}`);
    } finally {
      setSyncLoading(false);
    }
  }

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

  // 调试日志
  if (inventory.length > 0) {
    console.log("Inventory total:", inventory.length, "Filtered:", filtered.length, "Filters:", {
      statusFilter, categoryFilter, brandFilter, query
    });
  }

  // Parent rows: one per real TikTok product_id (first-seen order), plus
  // every non-TikTok product as its own standalone row, exactly as before.
  const [expandedProducts, setExpandedProducts] = useState({});
  const [variantDetails, setVariantDetails] = useState({}); // product_id -> { loading, error, data }
  const tiktokAccountId = (stores || []).find((s) => s.platform === "TikTok Shop" && s.connectionStatus === "connected")?.id || null;

  const erpSkusByProductId = new Map();
  for (const item of inventory) {
    const ids = tiktokIdsOf(item);
    if (ids) erpSkusByProductId.set(ids.productId, [...(erpSkusByProductId.get(ids.productId) || []), item]);
  }
  const displayRows = [];
  const groupIndex = new Map();
  for (const item of filtered) {
    const ids = tiktokIdsOf(item);
    if (!ids) { displayRows.push({ type: "single", item }); continue; }
    let group = groupIndex.get(ids.productId);
    if (!group) {
      group = { type: "tiktok", productId: ids.productId, items: [] };
      groupIndex.set(ids.productId, group);
      displayRows.push(group);
    }
    group.items.push(item);
  }

  // Read-only: live TikTok Get Product Detail via tiktok-sync-products
  // (action "variantDetail") — shown in the expanded row only, never
  // written back to products.
  async function loadVariants(productId) {
    if (!tiktokAccountId) {
      setVariantDetails((prev) => ({ ...prev, [productId]: { loading: false, error: t("没有已连接的 TikTok 店铺", "No connected TikTok store"), data: null } }));
      return;
    }
    setVariantDetails((prev) => ({ ...prev, [productId]: { loading: true, error: "", data: null } }));
    const { data, error } = await supabaseClient.functions.invoke("tiktok-sync-products", {
      body: { platformAccountId: tiktokAccountId, action: "variantDetail", productId },
    });
    if (error || !data?.success) {
      setVariantDetails((prev) => ({ ...prev, [productId]: { loading: false, error: data?.message || error?.message || "Unknown error", data: null } }));
      return;
    }
    setVariantDetails((prev) => ({ ...prev, [productId]: { loading: false, error: "", data } }));
  }

  function toggleExpand(productId) {
    const next = !expandedProducts[productId];
    setExpandedProducts((prev) => ({ ...prev, [productId]: next }));
    if (next && !variantDetails[productId]?.data && !variantDetails[productId]?.loading) loadVariants(productId);
  }

  function toggleSelectGroup(items) {
    const skus = items.map((i) => i.sku);
    const allOn = skus.every((sku) => selectedSkus.includes(sku));
    setSelectedSkus((prev) => (allOn ? prev.filter((s) => !skus.includes(s)) : Array.from(new Set([...prev, ...skus]))));
  }

  function renderErpActions(item) {
    return (
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
    );
  }

  function renderVariantPanel(group) {
    const erpItems = erpSkusByProductId.get(group.productId) || [];
    const erpBySkuId = new Map(erpItems.map((i) => [tiktokIdsOf(i).skuId, i]));
    const detailState = variantDetails[group.productId];
    const tiktokSkus = detailState?.data?.skus || [];
    const sellerSkuCount = new Map();
    for (const v of tiktokSkus) if (v.seller_sku) sellerSkuCount.set(v.seller_sku, (sellerSkuCount.get(v.seller_sku) || 0) + 1);
    const tiktokSkuIds = new Set(tiktokSkus.map((v) => v.sku_id));
    const erpOnly = detailState?.data ? erpItems.filter((i) => !tiktokSkuIds.has(tiktokIdsOf(i).skuId)) : [];
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
        <div className="text-xs text-slate-500">
          {t("TikTok 实时 Variant / SKU（只读）", "Live TikTok Variants / SKUs (read-only)")}
          {detailState?.data && ` · TikTok ${detailState.data.sku_count || 0} SKUs · ERP ${erpItems.length} SKUs`}
        </div>
        {detailState?.loading && <div className="text-xs text-slate-400 py-2">⏳ {t("正在读取 TikTok Product Detail…", "Loading TikTok Product Detail…")}</div>}
        {detailState?.error && (
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border bg-rose-50 text-rose-600 border-rose-200">
            <AlertTriangle size={13} /> TikTok: {detailState.error}
            <button onClick={() => loadVariants(group.productId)} className="ml-auto underline">{t("重试", "Retry")}</button>
          </div>
        )}
        {detailState?.data && (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-200">
                <th className="py-1.5 pr-3 font-medium w-10"></th>
                <th className="py-1.5 pr-3 font-medium">{t("规格", "Variant")}</th>
                <th className="py-1.5 pr-3 font-medium">Seller SKU</th>
                <th className="py-1.5 pr-3 font-medium">TikTok SKU ID</th>
                <th className="py-1.5 pr-3 font-medium">{t("TikTok 库存", "TikTok Stock")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("价格", "Price")}</th>
                <th className="py-1.5 pr-3 font-medium">ERP</th>
                <th className="py-1.5 pr-3 font-medium">{t("操作", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {tiktokSkus.map((v) => {
                const erpItem = erpBySkuId.get(v.sku_id);
                const state = erpItem
                  ? { label: t("已导入 ERP", "In ERP"), cls: "bg-emerald-50 text-emerald-600 border-emerald-200" }
                  : !v.seller_sku
                  ? { label: t("无 Seller SKU · 未导入", "No Seller SKU · not imported"), cls: "bg-slate-100 text-slate-500 border-slate-200" }
                  : sellerSkuCount.get(v.seller_sku) > 1
                  ? { label: t("Seller SKU 重复 · conflict", "Duplicate Seller SKU · conflict"), cls: "bg-amber-50 text-amber-600 border-amber-200" }
                  : { label: t("未导入 ERP", "Not in ERP"), cls: "bg-slate-100 text-slate-500 border-slate-200" };
                return (
                  <tr key={v.sku_id} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 pr-3">
                      {v.image ? <img src={v.image} alt={v.seller_sku || v.sku_id} className="h-8 w-8 object-cover rounded border border-slate-200" /> : <div className="h-8 w-8 rounded border border-slate-200 bg-white flex items-center justify-center text-slate-300"><Package size={12} /></div>}
                    </td>
                    <td className="py-1.5 pr-3">{(v.attributes && Array.isArray(v.attributes) && v.attributes.length > 0) ? v.attributes.map((a) => `${a.name}: ${a.value}`).join(" / ") : "—"}</td>
                    <td className="py-1.5 pr-3 font-medium">{v.seller_sku || "—"}</td>
                    <td className="py-1.5 pr-3 text-slate-500 tabular-nums">{v.sku_id}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{typeof v.stock === "number" ? v.stock : "—"}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{v.price ? `RM ${v.price.toFixed(2)}` : "—"}</td>
                    <td className="py-1.5 pr-3"><span className={`text-[11px] px-2 py-0.5 rounded-full border ${state.cls}`}>{state.label}</span></td>
                    <td className="py-1.5 pr-3">{erpItem ? renderErpActions(erpItem) : "—"}</td>
                  </tr>
                );
              })}
              {erpOnly.map((item) => (
                <tr key={item.sku} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 pr-3"></td>
                  <td className="py-1.5 pr-3 text-slate-400">—</td>
                  <td className="py-1.5 pr-3 font-medium">{item.sku}</td>
                  <td className="py-1.5 pr-3 text-slate-500 tabular-nums">{tiktokIdsOf(item).skuId}</td>
                  <td className="py-1.5 pr-3">—</td>
                  <td className="py-1.5 pr-3 tabular-nums">{item.price ? `RM ${item.price.toFixed(2)}` : "—"}</td>
                  <td className="py-1.5 pr-3"><span className="text-[11px] px-2 py-0.5 rounded-full border bg-rose-50 text-rose-600 border-rose-200">{t("仅 ERP · TikTok 已无此 SKU", "ERP only · not on TikTok")}</span></td>
                  <td className="py-1.5 pr-3">{renderErpActions(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  function renderSkuRow(item) {
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
  }

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
          onClick={() => setShowSyncModal(true)}
          className="ml-auto flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
        >
          <Download size={14} /> {t("同步店铺商品", "Sync Products")}
        </button>
        <button
          onClick={() => setFormState({ mode: "create" })}
          className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
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
              {displayRows.map((row) => {
                if (row.type === "single") return renderSkuRow(row.item);
                const group = row;
                const first = group.items[0];
                const image = group.items.find((i) => i.imageUrl)?.imageUrl || null;
                const totalErpSkus = (erpSkusByProductId.get(group.productId) || []).length;
                const prices = group.items.map((i) => i.price || 0).filter((p) => p > 0);
                const minP = prices.length ? Math.min(...prices) : 0;
                const maxP = prices.length ? Math.max(...prices) : 0;
                const groupStock = group.items.reduce((sum, i) => sum + i.warehouseA + i.warehouseB, 0);
                const groupSelected = group.items.every((i) => selectedSkus.includes(i.sku));
                const expanded = !!expandedProducts[group.productId];
                return (
                  <FragmentRows key={`tt-${group.productId}`}>
                    <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => toggleExpand(group.productId)}>
                      <td className="py-2.5 pr-3" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={groupSelected} onChange={() => toggleSelectGroup(group.items)} />
                      </td>
                      <td className="py-2.5 pr-3">
                        {image ? (
                          <img src={image} alt={first.name} className="h-10 w-10 object-cover rounded border border-slate-200" />
                        ) : (
                          <div className="h-10 w-10 rounded border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-300"><Package size={14} /></div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="text-[11px] px-2 py-0.5 rounded-full border bg-slate-50 text-slate-600 border-slate-200 whitespace-nowrap">
                          {group.items.length === totalErpSkus ? `${totalErpSkus} SKUs` : `${group.items.length} / ${totalErpSkus} SKUs`}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="font-medium">{first.name}</div>
                        <div className="text-[11px] text-slate-400 tabular-nums">Product ID: {group.productId}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-slate-500">—</td>
                      <td className="py-2.5 pr-3 text-slate-500">—</td>
                      <td className="py-2.5 pr-3 text-slate-500">—</td>
                      <td className="py-2.5 pr-3 text-slate-500">—</td>
                      <td className="py-2.5 pr-3 tabular-nums whitespace-nowrap">{prices.length ? (minP === maxP ? `RM ${minP.toFixed(2)}` : `RM ${minP.toFixed(2)} – ${maxP.toFixed(2)}`) : "—"}</td>
                      <td className="py-2.5 pr-3">—</td>
                      <td className="py-2.5 pr-3">—</td>
                      <td className="py-2.5 pr-3">—</td>
                      <td className="py-2.5 pr-3">—</td>
                      <td className="py-2.5 pr-3">—</td>
                      <td className="py-2.5 pr-3 tabular-nums font-medium">{groupStock}</td>
                      <td className="py-2.5 pr-3">
                        <span className="text-[11px] px-2 py-0.5 rounded-full border bg-slate-50 text-slate-500 border-slate-200">TikTok</span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <button onClick={(e) => { e.stopPropagation(); toggleExpand(group.productId); }} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 whitespace-nowrap">
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {expanded ? t("收起", "Collapse") : t("展开", "Expand")}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-slate-100">
                        <td colSpan={17} className="py-2 pl-10 pr-3">{renderVariantPanel(group)}</td>
                      </tr>
                    )}
                  </FragmentRows>
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

      {showSyncModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowSyncModal(false)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-sm font-medium"><Download size={16} className="text-emerald-600" /> {t("同步店铺商品", "Sync Products")}</div>
            <select value={selectedSyncStore || ""} onChange={(e) => setSelectedSyncStore(e.target.value)} className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg">
              <option value="">{t("选择店铺", "Select Store")}</option>
              {(stores || []).map(s => (
                <option key={s.id} value={s.id}>{s.account_name || s.name}</option>
              ))}
            </select>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowSyncModal(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-200">{t("取消", "Cancel")}</button>
              <button onClick={syncStoreProducts} disabled={!selectedSyncStore || syncLoading} className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50">
                {syncLoading ? "⏳" : <Download size={14} />} {t("开始同步", "Sync Now")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
