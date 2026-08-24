import { useState, useEffect, useRef } from "react";
import {
  Plus, Store, Percent, Sparkles, CheckCircle2, Bot, Zap,
  Image as ImageIcon, Upload, Layers, Trash2,
} from "lucide-react";
import { PLATFORM_THEME, DB_TO_DEMO_PLATFORM, fmt, supabaseClient } from "./shared.jsx";
import { KPICard as KPICardImpl } from "./pagesOverviewOrders.jsx";

// Shopee 物流渠道候选列表 (2026-08-24) — a fixed, common-sense set of
// real Malaysia Shopee delivery channel names for staff to toggle on this
// listing; not fetched from Shopee's real live logistics-channel API for
// the seller's account (no such integration exists — see the file-top
// data-source note).
const SHOPEE_SHIPPING_CHANNELS = ["Standard Delivery", "Shopee Xpress", "Poslaju", "J&T Express", "Ninja Van"];

// 商品发布中心 (2026-08-24) — data-source note, same spirit as the Ads
// Costs page's note: this is a real Supabase-backed feature
// (product_listings / product_listing_stores tables), but there is NO
// Shopee/TikTok Product API integration in this project (only Order/
// Settlement/Fulfillment/Auth are connected — confirmed by inspecting every
// edge function before building this). So "发布到店铺" and batch price
// adjustment only ever write to our own database, as a staging/tracking
// list — they never call a real platform API. publish_status='marked
// published' means a human confirmed they did it themselves on the real
// Shopee/TikTok seller center. This is a deliberate scope decision
// confirmed with the user 2026-08-24, not an oversight.
//
// Deliberately kept separate from `products` (pagesProducts.jsx /
// ProductMaster) — see the AutoCount system-direction memory: AutoCount is
// the sole stock master. This page never writes to products.price or
// products.*_qty; a listing may optionally reference a real product by
// product_id (for SKU/stock display only) or stand alone.
const AI_FRAME_TEMPLATES = [
  { id: "free_shipping", zh: "包邮 Free Shipping", en: "Free Shipping", color: "#16a34a", icon: "🚚" },
  { id: "hot_sale", zh: "爆款 Hot Sale", en: "Hot Sale", color: "#dc2626", icon: "🔥" },
  { id: "original", zh: "100% 正品 Original", en: "100% Original", color: "#2563eb", icon: "✅" },
];

const emptyListingForm = {
  product_id: "", sku: "", title: "", description: "", category: "", image_url: "", base_price: "",
  brand: "No Brand", weight_kg: "", length_cm: "", width_cm: "", height_cm: "", is_dangerous: false,
  shopee_shipping_channels: [], shopee_category_leaf_id: "", tiktok_category_leaf_id: "",
  attributes: [],
};

export function ProductListingCenter({ t, inventory, stores }) {
  const [activePlatform, setActivePlatform] = useState("Shopee");
  const [selectedStoreId, setSelectedStoreId] = useState(null);
  const storesForPlatform = (stores || []).filter((s) => s.platform === activePlatform);
  function switchPlatform(pf) {
    setActivePlatform(pf);
    setSelectedStoreId(null);
  }

  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function loadListings() {
    setLoading(true);
    const { data, error } = await supabaseClient
      .from("product_listings")
      .select("*, product_listing_stores(*, platform_accounts(id, platform, account_name))")
      .order("created_at", { ascending: false });
    if (!error) setListings(data || []);
    else console.error("loadListings failed", error);
    setLoading(false);
  }
  useEffect(() => { loadListings(); }, []);

  // ---- 内部类目库 (级联选择器 + 分类必填属性模板) ----
  // See the file-top note and the category_trees migration comment: this is
  // a staff-maintained internal dataset, NOT a live sync of Shopee/TikTok's
  // real category API (confirmed unavailable to this app — real 105005
  // scope-denied error, see tiktok-sync-orders/index.ts's 2026-08-24 note).
  const [categoryTrees, setCategoryTrees] = useState([]);
  const [attributeTemplates, setAttributeTemplates] = useState([]);
  async function loadCategoryData() {
    const [treesRes, templatesRes] = await Promise.all([
      supabaseClient.from("category_trees").select("*").order("level1").order("level2").order("level3"),
      supabaseClient.from("category_attribute_templates").select("*"),
    ]);
    if (!treesRes.error) setCategoryTrees(treesRes.data || []);
    else console.error("loadCategoryTrees failed", treesRes.error);
    if (!templatesRes.error) setAttributeTemplates(templatesRes.data || []);
    else console.error("loadAttributeTemplates failed", templatesRes.error);
  }
  useEffect(() => { loadCategoryData(); }, []);

  // Cascading-selector navigation state (level1/level2 picked so far) — the
  // final leaf id lives in listingForm.shopee_category_leaf_id /
  // tiktok_category_leaf_id, this is just which dropdown options to show.
  const [shopeeL1, setShopeeL1] = useState("");
  const [shopeeL2, setShopeeL2] = useState("");
  const [tiktokL1, setTiktokL1] = useState("");
  const [tiktokL2, setTiktokL2] = useState("");

  function categoryOptions(platform, field, l1, l2) {
    const rows = categoryTrees.filter((c) => c.platform === platform);
    if (field === "level1") return [...new Set(rows.map((c) => c.level1))];
    if (field === "level2") return [...new Set(rows.filter((c) => c.level1 === l1).map((c) => c.level2))];
    return rows.filter((c) => c.level1 === l1 && c.level2 === l2); // level3 → full leaf rows (need id)
  }

  // Selecting a leaf category auto-renders its template attributes (merged
  // with whatever's already filled — never overwrites an existing value,
  // only adds the template's attr_name rows that aren't present yet).
  function selectLeaf(platformKey, leafId) {
    const templates = attributeTemplates.filter((t) => t.category_leaf_id === leafId);
    setListingForm((prev) => {
      const existingNames = new Set(prev.attributes.map((a) => a.name));
      const added = templates.filter((t) => !existingNames.has(t.attr_name)).map((t) => ({ name: t.attr_name, value: "" }));
      return { ...prev, [platformKey]: leafId, attributes: [...prev.attributes, ...added] };
    });
  }

  // ---- 新建/编辑主商品发布清单 ----
  const [showListingForm, setShowListingForm] = useState(false);
  const [editingListingId, setEditingListingId] = useState(null);
  const [listingForm, setListingForm] = useState(emptyListingForm);

  function openCreateListing() {
    setEditingListingId(null);
    setListingForm(emptyListingForm);
    setShopeeL1(""); setShopeeL2(""); setTiktokL1(""); setTiktokL2("");
    setShowListingForm(true);
  }
  function openEditListing(l) {
    setEditingListingId(l.id);
    setListingForm({
      product_id: l.product_id || "", sku: l.sku || "", title: l.title, description: l.description || "",
      category: l.category || "", image_url: l.image_url || "", base_price: String(l.base_price),
      brand: l.brand || "No Brand",
      weight_kg: l.weight_kg != null ? String(l.weight_kg) : "",
      length_cm: l.length_cm != null ? String(l.length_cm) : "",
      width_cm: l.width_cm != null ? String(l.width_cm) : "",
      height_cm: l.height_cm != null ? String(l.height_cm) : "",
      is_dangerous: !!l.is_dangerous,
      shopee_shipping_channels: Array.isArray(l.shopee_shipping_channels) ? l.shopee_shipping_channels : [],
      shopee_category_leaf_id: l.shopee_category_leaf_id || "",
      tiktok_category_leaf_id: l.tiktok_category_leaf_id || "",
      attributes: Array.isArray(l.attributes) ? l.attributes : [],
    });
    // Re-derive the cascading dropdowns' level1/level2 from the saved leaf
    // id so editing shows the same path that was picked, not blank selects.
    const shopeeLeaf = categoryTrees.find((c) => c.id === l.shopee_category_leaf_id);
    setShopeeL1(shopeeLeaf?.level1 || ""); setShopeeL2(shopeeLeaf?.level2 || "");
    const tiktokLeaf = categoryTrees.find((c) => c.id === l.tiktok_category_leaf_id);
    setTiktokL1(tiktokLeaf?.level1 || ""); setTiktokL2(tiktokLeaf?.level2 || "");
    setShowListingForm(true);
  }
  // Picking a real product_id (from `inventory`, the real AutoCount-synced
  // catalog) auto-fills title/sku/image/price/category/weight from it, so
  // staff don't retype real data — but everything stays editable afterward
  // since a store listing's title/desc often needs to differ from the
  // internal SKU name.
  function pickRealProduct(sku) {
    const p = (inventory || []).find((i) => i.sku === sku);
    if (!p) { setListingForm({ ...listingForm, product_id: "", sku: "" }); return; }
    setListingForm({
      ...listingForm, product_id: p.id, sku: p.sku, title: listingForm.title || p.name,
      image_url: listingForm.image_url || p.imageUrl || "", category: listingForm.category || p.category || "",
      base_price: listingForm.base_price || String(p.price || ""),
      weight_kg: listingForm.weight_kg || (p.weightKg ? String(p.weightKg) : ""),
    });
  }

  function toggleShopeeChannel(name) {
    setListingForm((prev) => ({
      ...prev,
      shopee_shipping_channels: prev.shopee_shipping_channels.includes(name)
        ? prev.shopee_shipping_channels.filter((c) => c !== name)
        : [...prev.shopee_shipping_channels, name],
    }));
  }
  function addAttribute() {
    setListingForm((prev) => ({ ...prev, attributes: [...prev.attributes, { name: "", value: "" }] }));
  }
  function updateAttribute(idx, field, value) {
    setListingForm((prev) => ({ ...prev, attributes: prev.attributes.map((a, i) => (i === idx ? { ...a, [field]: value } : a)) }));
  }
  function removeAttribute(idx) {
    setListingForm((prev) => ({ ...prev, attributes: prev.attributes.filter((_, i) => i !== idx) }));
  }

  async function saveListing() {
    if (!listingForm.title.trim()) { showToast(t("请填写商品标题", "Please enter a title")); return; }
    // shopee_category_path/tiktok_category_path stay as a materialized
    // [level1,level2,level3] display copy derived from the chosen leaf, so
    // the listing table can show the path without a join.
    const shopeeLeaf = categoryTrees.find((c) => c.id === listingForm.shopee_category_leaf_id);
    const tiktokLeaf = categoryTrees.find((c) => c.id === listingForm.tiktok_category_leaf_id);
    const payload = {
      product_id: listingForm.product_id || null,
      sku: listingForm.sku.trim() || null,
      title: listingForm.title.trim(),
      description: listingForm.description.trim() || null,
      category: listingForm.category.trim() || null,
      image_url: listingForm.image_url.trim() || null,
      base_price: Number(listingForm.base_price) || 0,
      brand: listingForm.brand.trim() || "No Brand",
      weight_kg: listingForm.weight_kg ? Number(listingForm.weight_kg) : null,
      length_cm: listingForm.length_cm ? Number(listingForm.length_cm) : null,
      width_cm: listingForm.width_cm ? Number(listingForm.width_cm) : null,
      height_cm: listingForm.height_cm ? Number(listingForm.height_cm) : null,
      is_dangerous: listingForm.is_dangerous,
      shopee_shipping_channels: listingForm.shopee_shipping_channels,
      shopee_category_leaf_id: listingForm.shopee_category_leaf_id || null,
      tiktok_category_leaf_id: listingForm.tiktok_category_leaf_id || null,
      shopee_category_path: shopeeLeaf ? [shopeeLeaf.level1, shopeeLeaf.level2, shopeeLeaf.level3] : null,
      tiktok_category_path: tiktokLeaf ? [tiktokLeaf.level1, tiktokLeaf.level2, tiktokLeaf.level3] : null,
      attributes: listingForm.attributes.filter((a) => a.name.trim()),
      updated_at: new Date().toISOString(),
    };
    const { error } = editingListingId
      ? await supabaseClient.from("product_listings").update(payload).eq("id", editingListingId)
      : await supabaseClient.from("product_listings").insert(payload);
    if (error) { showToast(t("保存失败", "Save failed")); console.error("saveListing failed", error); return; }
    setShowListingForm(false);
    showToast(t("已保存", "Saved"));
    loadListings();
  }

  async function deleteListing(id) {
    const { error } = await supabaseClient.from("product_listings").delete().eq("id", id);
    if (error) { showToast(t("删除失败", "Delete failed")); console.error("deleteListing failed", error); return; }
    showToast(t("已删除", "Deleted"));
    loadListings();
  }

  // ---- 发布到店铺 ----
  const [publishTarget, setPublishTarget] = useState(null); // listing object
  const [publishStoreIds, setPublishStoreIds] = useState(new Set());

  function openPublish(listing) {
    setPublishTarget(listing);
    const already = new Set((listing.product_listing_stores || []).map((s) => s.platform_account_id));
    setPublishStoreIds(already);
  }
  function togglePublishStore(id) {
    setPublishStoreIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  async function confirmPublish() {
    if (!publishTarget) return;
    const rows = [...publishStoreIds].map((platform_account_id) => ({
      listing_id: publishTarget.id,
      platform_account_id,
      store_price: publishTarget.base_price,
    }));
    // upsert so re-opening this modal and adding one more store doesn't
    // duplicate-error on the already-queued ones (unique(listing_id,
    // platform_account_id)).
    const { error } = rows.length > 0
      ? await supabaseClient.from("product_listing_stores").upsert(rows, { onConflict: "listing_id,platform_account_id", ignoreDuplicates: true })
      : { error: null };
    if (error) { showToast(t("操作失败", "Action failed")); console.error("confirmPublish failed", error); return; }
    setPublishTarget(null);
    showToast(t("已加入发布清单——请自行在 Shopee/TikTok 后台完成真正的上架", "Added to the publish list — please launch it for real in the Shopee/TikTok seller center yourself"));
    loadListings();
  }

  async function markPublished(storeRowId) {
    const { error } = await supabaseClient.from("product_listing_stores").update({ publish_status: "marked_published", updated_at: new Date().toISOString() }).eq("id", storeRowId);
    if (error) { showToast(t("操作失败", "Action failed")); console.error("markPublished failed", error); return; }
    showToast(t("已标记为已发布", "Marked as published"));
    loadListings();
  }

  // ---- 店铺定价清单 (flattened product_listing_stores rows) ----
  const allStoreRows = listings.flatMap((l) =>
    (l.product_listing_stores || []).map((s) => ({
      ...s,
      listingTitle: l.title,
      listingImage: l.watermarked_image_url || l.image_url,
      listingSku: l.sku,
      platform: DB_TO_DEMO_PLATFORM[s.platform_accounts?.platform] || s.platform_accounts?.platform,
      storeName: s.platform_accounts?.account_name || "—",
    })),
  );
  const storeRows = allStoreRows.filter((r) => r.platform === activePlatform && (!selectedStoreId || r.platform_account_id === selectedStoreId));

  // ---- 批量调价 & 佣金对冲 ----
  const [selectedRowIds, setSelectedRowIds] = useState(new Set());
  const [showBatchPrice, setShowBatchPrice] = useState(false);
  const [batchMode, setBatchMode] = useState("percent"); // percent | fixed | set | commission
  const [batchValue, setBatchValue] = useState("");

  function toggleRow(id) {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAllRows() {
    setSelectedRowIds((prev) => (prev.size === storeRows.length ? new Set() : new Set(storeRows.map((r) => r.id))));
  }

  // 平台佣金对冲公式 (2026-08-24) — commission is charged as a % of the
  // selling price, so a naive "+X%" price bump does NOT fully offset a
  // ΔX-percentage-point commission increase (it overshoots slightly,
  // because the extra commission is also charged on the price increase
  // itself). The algebraically exact hedge that keeps net-after-commission
  // proceeds unchanged is newPrice = oldPrice / (1 - ΔX/100).
  function computeBatchPrice(oldPrice) {
    const v = Number(batchValue) || 0;
    if (batchMode === "percent") return +(oldPrice * (1 + v / 100)).toFixed(2);
    if (batchMode === "fixed") return +(oldPrice + v).toFixed(2);
    if (batchMode === "set") return +v.toFixed(2);
    if (batchMode === "commission") return v >= 100 ? oldPrice : +(oldPrice / (1 - v / 100)).toFixed(2);
    return oldPrice;
  }

  async function applyBatchPrice() {
    const targets = storeRows.filter((r) => selectedRowIds.has(r.id));
    if (targets.length === 0) return;
    const noteMap = {
      percent: (v) => t(`批量调价 ${v >= 0 ? "+" : ""}${v}%`, `Batch adjust ${v >= 0 ? "+" : ""}${v}%`),
      fixed: (v) => t(`批量调价 ${v >= 0 ? "+" : ""}RM${v}`, `Batch adjust ${v >= 0 ? "+" : ""}RM${v}`),
      set: (v) => t(`统一定价 RM${v}`, `Set uniform price RM${v}`),
      commission: (v) => t(`佣金对冲 +${v}%（自动反推涨幅）`, `Commission hedge +${v}% (auto-derived increase)`),
    };
    const note = noteMap[batchMode](Number(batchValue) || 0);
    let failed = 0;
    for (const r of targets) {
      const newPrice = computeBatchPrice(r.store_price);
      const { error } = await supabaseClient.from("product_listing_stores").update({
        store_price: newPrice, last_price_adjustment_note: note, updated_at: new Date().toISOString(),
      }).eq("id", r.id);
      if (error) { failed++; console.error("applyBatchPrice failed", error); }
    }
    setShowBatchPrice(false);
    setSelectedRowIds(new Set());
    showToast(failed > 0
      ? t(`已调整 ${targets.length - failed} 项，${failed} 项失败`, `Adjusted ${targets.length - failed}, ${failed} failed`)
      : t(`已批量调价 ${targets.length} 项——请自行同步到各店铺后台`, `Batch-adjusted ${targets.length} items — please sync to each store's console yourself`));
    loadListings();
  }

  // ---- AI 水印/爆款框架助手 (纯 Canvas，无外部 API) ----
  const [watermarkTarget, setWatermarkTarget] = useState(null); // listing
  const [watermarkTemplate, setWatermarkTemplate] = useState(AI_FRAME_TEMPLATES[0].id);
  const [watermarkPreview, setWatermarkPreview] = useState(null); // data URL
  const [watermarkError, setWatermarkError] = useState("");
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  function drawFrame(img) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const tpl = AI_FRAME_TEMPLATES.find((f) => f.id === watermarkTemplate) || AI_FRAME_TEMPLATES[0];
    const bannerH = Math.max(24, Math.round(h * 0.1));
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = tpl.color;
    ctx.fillRect(0, h - bannerH, w, bannerH);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(bannerH * 0.45)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${tpl.icon} ${t(tpl.zh, tpl.en)}`, w / 2, h - bannerH / 2);
    try {
      setWatermarkPreview(canvas.toDataURL("image/jpeg", 0.88));
      setWatermarkError("");
    } catch {
      // Cross-origin image without CORS headers taints the canvas — cannot
      // read it back as a data URL. Real, expected failure mode for
      // arbitrary external image_url values; upload-from-file always works
      // instead since it never touches a remote origin.
      setWatermarkError(t(
        "该图片跨域，浏览器无法导出合成结果——请改用「上传本地图片」",
        "This image is cross-origin — the browser can't export the result. Please use \"Upload local image\" instead.",
      ));
      setWatermarkPreview(null);
    }
  }

  function loadImageFromUrl(url) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => drawFrame(img);
    img.onerror = () => setWatermarkError(t("图片加载失败", "Failed to load image"));
    img.src = url;
  }
  function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => drawFrame(img);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  async function saveWatermark() {
    if (!watermarkTarget || !watermarkPreview) return;
    const { error } = await supabaseClient.from("product_listings").update({ watermarked_image_url: watermarkPreview, updated_at: new Date().toISOString() }).eq("id", watermarkTarget.id);
    if (error) { showToast(t("保存失败", "Save failed")); console.error("saveWatermark failed", error); return; }
    setWatermarkTarget(null);
    setWatermarkPreview(null);
    showToast(t("已保存水印图，并已同步更新到发布清单预览", "Watermarked image saved and updated in the listing preview"));
    loadListings();
  }

  // ---- 多层级规格与 SKU 变体管理 ----
  const [variationsTarget, setVariationsTarget] = useState(null); // listing
  const [spec1Name, setSpec1Name] = useState("");
  const [spec1Values, setSpec1Values] = useState("");
  const [spec2Name, setSpec2Name] = useState("");
  const [spec2Values, setSpec2Values] = useState("");
  const [variationRows, setVariationRows] = useState([]); // [{spec1_value, spec2_value, sku, price, stock, image_url}]

  async function openVariations(listing) {
    setVariationsTarget(listing);
    const { data, error } = await supabaseClient.from("product_listing_variations").select("*").eq("listing_id", listing.id).order("created_at");
    if (error) { console.error("loadVariations failed", error); setVariationRows([]); return; }
    setVariationRows(data || []);
    setSpec1Name(data?.[0]?.spec1_name || "");
    setSpec2Name(data?.[0]?.spec2_name || "");
    setSpec1Values([...new Set((data || []).map((r) => r.spec1_value).filter(Boolean))].join(","));
    setSpec2Values([...new Set((data || []).map((r) => r.spec2_value).filter(Boolean))].join(","));
  }

  // 生成组合 — cartesian product of spec1 × spec2 values (spec2 optional,
  // for a single-level spec). Preserves an existing row's sku/price/stock/
  // image if that exact combination was already there, so regenerating
  // after adding one more value doesn't wipe out data already entered.
  function generateCombos() {
    const v1 = spec1Values.split(",").map((s) => s.trim()).filter(Boolean);
    const v2 = spec2Values.split(",").map((s) => s.trim()).filter(Boolean);
    const existing = new Map(variationRows.map((r) => [`${r.spec1_value || ""}|${r.spec2_value || ""}`, r]));
    const combos = [];
    const pairs = v2.length > 0 ? v1.flatMap((a) => v2.map((b) => [a, b])) : v1.map((a) => [a, ""]);
    for (const [a, b] of pairs) {
      const key = `${a}|${b}`;
      combos.push(existing.get(key) || { spec1_value: a, spec2_value: b, sku: "", price: listingFormBasePriceFallback(), stock: 0, image_url: "" });
    }
    setVariationRows(combos);
  }
  // Small helper so a freshly-generated combo starts from the parent
  // listing's real base price instead of RM0, saving retyping.
  function listingFormBasePriceFallback() {
    return Number(variationsTarget?.base_price) || 0;
  }
  function updateVariationField(idx, field, value) {
    setVariationRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }
  function removeVariationRow(idx) {
    setVariationRows((prev) => prev.filter((_, i) => i !== idx));
  }

  async function saveVariations() {
    if (!variationsTarget) return;
    const { error: delErr } = await supabaseClient.from("product_listing_variations").delete().eq("listing_id", variationsTarget.id);
    if (delErr) { showToast(t("保存失败", "Save failed")); console.error("saveVariations delete failed", delErr); return; }
    if (variationRows.length > 0) {
      const rows = variationRows.map((r) => ({
        listing_id: variationsTarget.id,
        spec1_name: spec1Name.trim() || null, spec1_value: r.spec1_value || null,
        spec2_name: spec2Name.trim() || null, spec2_value: r.spec2_value || null,
        sku: r.sku?.trim() || null, price: Number(r.price) || 0, stock: Math.round(Number(r.stock)) || 0,
        image_url: r.image_url?.trim() || null,
      }));
      const { error } = await supabaseClient.from("product_listing_variations").insert(rows);
      if (error) { showToast(t("保存失败", "Save failed")); console.error("saveVariations insert failed", error); return; }
    }
    setVariationsTarget(null);
    showToast(t("已保存 SKU 变体", "Variations saved"));
    loadListings();
  }

  // ---- 类目库管理 (2026-08-24, new) — lets staff grow/edit the internal
  // category_trees + category_attribute_templates dataset from the UI,
  // since there's no live official API to sync from (see file-top note).
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [newCategory, setNewCategory] = useState({ platform: "Shopee", level1: "", level2: "", level3: "" });
  const [expandedLeafId, setExpandedLeafId] = useState(null);
  const [newAttrName, setNewAttrName] = useState("");
  const [newAttrRequired, setNewAttrRequired] = useState(true);

  async function addCategoryLeaf() {
    const { platform, level1, level2, level3 } = newCategory;
    if (!level1.trim() || !level2.trim() || !level3.trim()) { showToast(t("请填写完整三级分类", "Please fill in all 3 levels")); return; }
    const { error } = await supabaseClient.from("category_trees").insert({
      platform, level1: level1.trim(), level2: level2.trim(), level3: level3.trim(),
    });
    if (error) {
      showToast(error.code === "23505" ? t("该分类已存在", "This category already exists") : t("添加失败", "Add failed"));
      console.error("addCategoryLeaf failed", error);
      return;
    }
    setNewCategory({ platform, level1: "", level2: "", level3: "" });
    showToast(t("已添加分类", "Category added"));
    loadCategoryData();
  }
  async function deleteCategoryLeaf(id) {
    const { error } = await supabaseClient.from("category_trees").delete().eq("id", id);
    if (error) { showToast(t("删除失败", "Delete failed")); console.error("deleteCategoryLeaf failed", error); return; }
    showToast(t("已删除", "Deleted"));
    loadCategoryData();
  }
  async function addAttributeTemplate(leafId) {
    if (!newAttrName.trim()) return;
    const { error } = await supabaseClient.from("category_attribute_templates").insert({
      category_leaf_id: leafId, attr_name: newAttrName.trim(), required: newAttrRequired,
    });
    if (error) { showToast(t("添加失败", "Add failed")); console.error("addAttributeTemplate failed", error); return; }
    setNewAttrName("");
    loadCategoryData();
  }
  async function deleteAttributeTemplate(id) {
    const { error } = await supabaseClient.from("category_attribute_templates").delete().eq("id", id);
    if (error) { console.error("deleteAttributeTemplate failed", error); return; }
    loadCategoryData();
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg">{toast}</div>
      )}

      {/* 数据来源提示 (2026-08-24) — see the top-of-file comment for the
          full rationale; kept visible on-page per user's explicit request. */}
      <div className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2">
        <Bot size={14} className="shrink-0 mt-0.5" />
        {t(
          "🤖 尚未接通 Shopee/TikTok 官方商品 API，「发布」「批量调价」目前仅写入 ERP 内部清单供预览与管理，请在操作后自行到各平台后台完成真正的上架/改价。",
          "🤖 Not yet connected to Shopee/TikTok's official Product API — \"Publish\" and \"Batch Price\" only write to this ERP's internal list for preview/management; please complete the real listing/price update yourself in each platform's seller console.",
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex bg-white border border-slate-200 rounded-xl p-1 gap-1">
          {["Shopee", "TikTok Shop"].map((pf) => {
            const pfTheme = PLATFORM_THEME[pf];
            const active = activePlatform === pf;
            return (
              <button
                key={pf}
                onClick={() => switchPlatform(pf)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${active ? `${pfTheme.headerBg} text-white` : "text-slate-500 hover:bg-slate-50"}`}
              >
                <span className={`h-2 w-2 rounded-full ${active ? "bg-white/80" : pfTheme.dot}`} />
                {pf}
              </button>
            );
          })}
        </div>
        {storesForPlatform.length > 0 && (
          <select value={selectedStoreId || ""} onChange={(e) => setSelectedStoreId(e.target.value || null)} className="text-sm px-3 py-2 border border-slate-200 rounded-lg bg-white">
            <option value="">{t("全部店铺", "All Stores")}</option>
            {storesForPlatform.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICardImpl label={t("发布清单商品数", "Listings")} value={String(listings.length)} icon={Store} tone="bg-slate-700" />
        <KPICardImpl label={t(`${activePlatform} 店铺定价数`, `${activePlatform} Store Prices`)} value={String(storeRows.length)} icon={Store} tone={PLATFORM_THEME[activePlatform].headerBg} />
        <KPICardImpl label={t("已标记发布", "Marked Published")} value={String(storeRows.filter((r) => r.publish_status === "marked_published").length)} icon={CheckCircle2} tone="bg-emerald-500" />
        <KPICardImpl label={t("待发布", "Pending")} value={String(storeRows.filter((r) => r.publish_status === "pending").length)} icon={Store} tone="bg-amber-500" />
      </div>

      {/* 主商品发布清单 */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div className="text-sm font-medium">{t("主商品发布清单", "Master Listing Catalog")}</div>
          <button onClick={openCreateListing} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800">
            <Plus size={13} /> {t("新增商品", "New Listing")}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-3 pl-5 font-medium">{t("商品", "Product")}</th>
                <th className="py-2 pr-3 font-medium">{t("SKU / 库存", "SKU / Stock")}</th>
                <th className="py-2 pr-3 font-medium text-right">{t("基础售价 (RM)", "Base Price (RM)")}</th>
                <th className="py-2 pr-3 font-medium text-center">{t("已发布店铺数", "Stores Queued")}</th>
                <th className="py-2 pr-3 pr-5 font-medium text-right">{t("操作", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="py-6 text-center text-xs text-slate-400">{t("加载中…", "Loading…")}</td></tr>}
              {!loading && listings.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-xs text-slate-400">{t("暂无商品，点击「新增商品」开始", 'No listings yet — click "New Listing" to start')}</td></tr>
              )}
              {!loading && listings.map((l) => {
                const realProduct = (inventory || []).find((i) => i.id === l.product_id);
                return (
                  <tr key={l.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="py-2.5 pr-3 pl-5">
                      <div className="flex items-center gap-2 min-w-0">
                        {(l.watermarked_image_url || l.image_url) ? (
                          <img src={l.watermarked_image_url || l.image_url} alt={l.title} className="h-10 w-10 rounded-md object-cover border border-slate-200 shrink-0" />
                        ) : (
                          <div className="h-10 w-10 rounded-md bg-slate-100 border border-slate-200 shrink-0" />
                        )}
                        <span className="truncate max-w-[180px] font-medium">{l.title}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-slate-500">
                      {l.sku || "—"}
                      {/* 真实库存 (2026-08-24) — read-only display sourced from
                          the real AutoCount-synced `products` row (via
                          `inventory` prop), never editable here — stock
                          stays owned by AutoCount, this page never writes it. */}
                      {realProduct && <div className="text-slate-400">{t(`库存 ${realProduct.warehouseA + realProduct.warehouseB}`, `Stock ${realProduct.warehouseA + realProduct.warehouseB}`)}</div>}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{fmt(l.base_price)}</td>
                    <td className="py-2.5 pr-3 text-center tabular-nums">{(l.product_listing_stores || []).length}</td>
                    <td className="py-2.5 pr-3 pr-5 text-right whitespace-nowrap">
                      <button onClick={() => openPublish(l)} className="text-xs text-indigo-600 hover:text-indigo-800 mr-2">{t("发布到店铺", "Publish")}</button>
                      <button onClick={() => openVariations(l)} className="text-xs text-purple-600 hover:text-purple-800 mr-2">{t("规格/SKU变体", "Variations")}</button>
                      <button onClick={() => { setWatermarkTarget(l); setWatermarkPreview(null); setWatermarkError(""); }} className="text-xs text-emerald-600 hover:text-emerald-800 mr-2">{t("AI 水印", "Watermark")}</button>
                      <button onClick={() => openEditListing(l)} className="text-xs text-slate-500 hover:text-slate-800 mr-2">{t("编辑", "Edit")}</button>
                      <button onClick={() => deleteListing(l.id)} className="text-xs text-rose-500 hover:text-rose-700">{t("删除", "Delete")}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 店铺定价清单 + 批量调价 */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div className="text-sm font-medium">{t(`${activePlatform} 店铺定价清单`, `${activePlatform} Store Pricing`)}</div>
          <button
            onClick={() => setShowBatchPrice(true)}
            disabled={selectedRowIds.size === 0}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-white ${selectedRowIds.size > 0 ? "bg-gradient-to-r from-indigo-600 to-purple-600 hover:opacity-90" : "bg-slate-300 cursor-not-allowed"}`}
          >
            <Percent size={13} /> {t(`批量调价 (${selectedRowIds.size})`, `Batch Price (${selectedRowIds.size})`)}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-3 pl-5 font-medium w-8">
                  <input type="checkbox" checked={storeRows.length > 0 && selectedRowIds.size === storeRows.length} onChange={toggleAllRows} className="h-3.5 w-3.5 rounded border-slate-300" />
                </th>
                <th className="py-2 pr-3 font-medium">{t("商品", "Product")}</th>
                <th className="py-2 pr-3 font-medium">{t("店铺", "Store")}</th>
                <th className="py-2 pr-3 font-medium text-right">{t("店铺售价 (RM)", "Store Price (RM)")}</th>
                <th className="py-2 pr-3 font-medium">{t("最近调价", "Last Adjustment")}</th>
                <th className="py-2 pr-3 font-medium text-center">{t("状态", "Status")}</th>
                <th className="py-2 pr-3 pr-5 font-medium text-right">{t("操作", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {!loading && storeRows.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-xs text-slate-400">{t("该平台/店铺暂无已发布商品", "No published items for this platform/store yet")}</td></tr>
              )}
              {storeRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="py-2.5 pr-3 pl-5"><input type="checkbox" checked={selectedRowIds.has(r.id)} onChange={() => toggleRow(r.id)} className="h-3.5 w-3.5 rounded border-slate-300" /></td>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {r.listingImage ? <img src={r.listingImage} alt={r.listingTitle} className="h-8 w-8 rounded-md object-cover border border-slate-200 shrink-0" /> : <div className="h-8 w-8 rounded-md bg-slate-100 border border-slate-200 shrink-0" />}
                      <span className="truncate max-w-[160px] text-xs">{r.listingTitle}</span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-slate-600">{r.storeName}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums font-medium">{fmt(r.store_price)}</td>
                  <td className="py-2.5 pr-3 text-xs text-slate-400 max-w-[160px] truncate">{r.last_price_adjustment_note || "—"}</td>
                  <td className="py-2.5 pr-3 text-center">
                    {r.publish_status === "marked_published" ? (
                      <span className="text-xs px-2 py-0.5 rounded-full border bg-emerald-100 text-emerald-700 border-emerald-200">{t("已发布", "Published")}</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full border bg-amber-100 text-amber-700 border-amber-200">{t("待发布", "Pending")}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 pr-5 text-right">
                    {r.publish_status !== "marked_published" && (
                      <button onClick={() => markPublished(r.id)} className="text-xs text-emerald-600 hover:text-emerald-800">{t("标记已发布", "Mark Published")}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新增/编辑商品 */}
      {showListingForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowListingForm(false)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-medium">{editingListingId ? t("编辑商品", "Edit Listing") : t("新增商品", "New Listing")}</div>
            <div>
              <div className="text-xs text-slate-400 mb-1">{t("关联真实商品 SKU（可选，自动带入）", "Link a real product SKU (optional, auto-fills)")}</div>
              <select value={listingForm.sku} onChange={(e) => pickRealProduct(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg">
                <option value="">{t("不关联", "Not linked")}</option>
                {(inventory || []).map((p) => <option key={p.sku} value={p.sku}>{p.sku} — {p.name}</option>)}
              </select>
            </div>
            <div>
              <div className="text-xs text-slate-400 mb-1">{t("商品标题", "Title")}</div>
              <input value={listingForm.title} onChange={(e) => setListingForm({ ...listingForm, title: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>
            <div>
              <div className="text-xs text-slate-400 mb-1">{t("详情描述", "Description")}</div>
              <textarea value={listingForm.description} onChange={(e) => setListingForm({ ...listingForm, description: e.target.value })} rows={3} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-slate-400 mb-1">{t("分类", "Category")}</div>
                <input value={listingForm.category} onChange={(e) => setListingForm({ ...listingForm, category: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div>
                <div className="text-xs text-slate-400 mb-1">{t("基础售价 (RM)", "Base Price (RM)")}</div>
                <input type="number" value={listingForm.base_price} onChange={(e) => setListingForm({ ...listingForm, base_price: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400 mb-1">{t("主图链接", "Main Image URL")}</div>
              <input value={listingForm.image_url} onChange={(e) => setListingForm({ ...listingForm, image_url: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>
            <div>
              <div className="text-xs text-slate-400 mb-1">{t("品牌", "Brand")}</div>
              <input value={listingForm.brand} onChange={(e) => setListingForm({ ...listingForm, brand: e.target.value })} placeholder="No Brand" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>

            {/* 包裹信息 (2026-08-24, new) — real fields both platforms'
                real Product APIs require, captured here ahead of time (see
                file-top note: not validated against a live API). Weight
                auto-fills from the real linked product when available. */}
            <div className="pt-2 border-t border-slate-100">
              <div className="text-xs font-medium text-slate-500 mb-2">{t("📦 包裹信息", "📦 Package Info")}</div>
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <div className="text-[11px] text-slate-400 mb-1">{t("重量 (kg)", "Weight (kg)")}</div>
                  <input type="number" value={listingForm.weight_kg} onChange={(e) => setListingForm({ ...listingForm, weight_kg: e.target.value })} className="w-full px-2 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 mb-1">{t("长 (cm)", "L (cm)")}</div>
                  <input type="number" value={listingForm.length_cm} onChange={(e) => setListingForm({ ...listingForm, length_cm: e.target.value })} className="w-full px-2 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 mb-1">{t("宽 (cm)", "W (cm)")}</div>
                  <input type="number" value={listingForm.width_cm} onChange={(e) => setListingForm({ ...listingForm, width_cm: e.target.value })} className="w-full px-2 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 mb-1">{t("高 (cm)", "H (cm)")}</div>
                  <input type="number" value={listingForm.height_cm} onChange={(e) => setListingForm({ ...listingForm, height_cm: e.target.value })} className="w-full px-2 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
              </div>
            </div>

            {/* TikTok 危险品声明 */}
            <div>
              <div className="text-xs font-medium text-slate-500 mb-1">{t("⚠️ TikTok 合规声明", "⚠️ TikTok Compliance")}</div>
              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                <input type="checkbox" checked={listingForm.is_dangerous} onChange={(e) => setListingForm({ ...listingForm, is_dangerous: e.target.checked })} className="h-3.5 w-3.5 rounded border-slate-300" />
                {t("包含电池/液体/危险品 (Hazardous Goods/Batteries)", "Contains batteries/liquid/hazardous goods")}
              </label>
            </div>

            {/* Shopee 物流渠道 */}
            <div>
              <div className="text-xs font-medium text-slate-500 mb-1">{t("🚚 Shopee 物流渠道", "🚚 Shopee Shipping Channels")}</div>
              <div className="flex flex-wrap gap-2">
                {SHOPEE_SHIPPING_CHANNELS.map((ch) => (
                  <label key={ch} className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer ${listingForm.shopee_shipping_channels.includes(ch) ? "bg-orange-50 border-orange-300 text-orange-700" : "border-slate-200 text-slate-500"}`}>
                    <input type="checkbox" checked={listingForm.shopee_shipping_channels.includes(ch)} onChange={() => toggleShopeeChannel(ch)} className="hidden" />
                    {ch}
                  </label>
                ))}
              </div>
            </div>

            {/* 平台分类映射 — 级联选择器 (2026-08-24) — sourced from the
                internal category_trees table (see file-top note: NOT a live
                Shopee/TikTok category-tree API, that access is confirmed
                unavailable to this app). Selecting a level-3 leaf
                auto-renders its attribute template below. */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-medium text-slate-500">{t("🗂 Shopee 三级分类（内部类目库）", "🗂 Shopee Category (internal library)")}</div>
                <button onClick={() => setShowCategoryManager(true)} className="text-[11px] text-indigo-600 hover:text-indigo-800">{t("管理类目库", "Manage")}</button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select value={shopeeL1} onChange={(e) => { setShopeeL1(e.target.value); setShopeeL2(""); selectLeaf("shopee_category_leaf_id", ""); }} className="w-full px-2 py-2 text-xs border border-slate-200 rounded-lg bg-white">
                  <option value="">{t("第1级", "Level 1")}</option>
                  {categoryOptions("Shopee", "level1").map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                <select value={shopeeL2} onChange={(e) => { setShopeeL2(e.target.value); selectLeaf("shopee_category_leaf_id", ""); }} disabled={!shopeeL1} className="w-full px-2 py-2 text-xs border border-slate-200 rounded-lg bg-white disabled:bg-slate-50">
                  <option value="">{t("第2级", "Level 2")}</option>
                  {categoryOptions("Shopee", "level2", shopeeL1).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                <select value={listingForm.shopee_category_leaf_id} onChange={(e) => selectLeaf("shopee_category_leaf_id", e.target.value)} disabled={!shopeeL2} className="w-full px-2 py-2 text-xs border border-slate-200 rounded-lg bg-white disabled:bg-slate-50">
                  <option value="">{t("第3级", "Level 3")}</option>
                  {categoryOptions("Shopee", "level3", shopeeL1, shopeeL2).map((c) => <option key={c.id} value={c.id}>{c.level3}</option>)}
                </select>
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500 mb-1">{t("🗂 TikTok 三级分类（内部类目库）", "🗂 TikTok Category (internal library)")}</div>
              <div className="grid grid-cols-3 gap-2">
                <select value={tiktokL1} onChange={(e) => { setTiktokL1(e.target.value); setTiktokL2(""); selectLeaf("tiktok_category_leaf_id", ""); }} className="w-full px-2 py-2 text-xs border border-slate-200 rounded-lg bg-white">
                  <option value="">{t("第1级", "Level 1")}</option>
                  {categoryOptions("TikTok Shop", "level1").map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                <select value={tiktokL2} onChange={(e) => { setTiktokL2(e.target.value); selectLeaf("tiktok_category_leaf_id", ""); }} disabled={!tiktokL1} className="w-full px-2 py-2 text-xs border border-slate-200 rounded-lg bg-white disabled:bg-slate-50">
                  <option value="">{t("第2级", "Level 2")}</option>
                  {categoryOptions("TikTok Shop", "level2", tiktokL1).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                <select value={listingForm.tiktok_category_leaf_id} onChange={(e) => selectLeaf("tiktok_category_leaf_id", e.target.value)} disabled={!tiktokL2} className="w-full px-2 py-2 text-xs border border-slate-200 rounded-lg bg-white disabled:bg-slate-50">
                  <option value="">{t("第3级", "Level 3")}</option>
                  {categoryOptions("TikTok Shop", "level3", tiktokL1, tiktokL2).map((c) => <option key={c.id} value={c.id}>{c.level3}</option>)}
                </select>
              </div>
            </div>
            {(listingForm.shopee_category_leaf_id || listingForm.tiktok_category_leaf_id) && (
              <div className="text-[11px] text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-lg px-2.5 py-1.5">
                {t("已根据选中的叶子类目自动带入下方必填属性，请核对填写。", "Attributes below were auto-added from the selected leaf category — please review and fill them in.")}
              </div>
            )}

            {/* 动态必填属性 (2026-08-24, new) — free-form name/value pairs
                (e.g. Warranty Type, Material) so staff has somewhere to
                record a category's mandatory attributes; not fetched from
                either platform's real per-category attribute schema. */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-medium text-slate-500">{t("📋 分类必填属性", "📋 Category Attributes")}</div>
                <button onClick={addAttribute} className="text-xs text-indigo-600 hover:text-indigo-800">+ {t("添加属性", "Add")}</button>
              </div>
              <div className="space-y-1.5">
                {listingForm.attributes.map((a, idx) => (
                  <div key={idx} className="flex gap-2">
                    <input value={a.name} onChange={(e) => updateAttribute(idx, "name", e.target.value)} placeholder={t("属性名（如 Warranty Type）", "Attribute name (e.g. Warranty Type)")} className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                    <input value={a.value} onChange={(e) => updateAttribute(idx, "value", e.target.value)} placeholder={t("值（如 1 Year）", "Value (e.g. 1 Year)")} className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                    <button onClick={() => removeAttribute(idx)} className="text-rose-400 hover:text-rose-600"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowListingForm(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">{t("取消", "Cancel")}</button>
              <button onClick={saveListing} className="text-sm px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800">{t("保存", "Save")}</button>
            </div>
          </div>
        </div>
      )}

      {/* 发布到店铺 */}
      {publishTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPublishTarget(null)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-sm font-medium"><Store size={16} className="text-indigo-600" /> {t(`发布「${publishTarget.title}」到店铺`, `Publish "${publishTarget.title}" to stores`)}</div>
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {t("勾选的店铺会加入 ERP 内部发布清单，不会自动在真实平台创建商品——请自行到后台完成实际上架。", "Checked stores are added to this ERP's internal list only — this does not create a real listing on the platform; please publish it for real in the seller console yourself.")}
            </div>
            <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
              {(stores || []).length === 0 && <div className="p-3 text-xs text-slate-400">{t("暂无已连接店铺", "No connected stores")}</div>}
              {(stores || []).map((s) => (
                <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                  <input type="checkbox" checked={publishStoreIds.has(s.id)} onChange={() => togglePublishStore(s.id)} className="h-3.5 w-3.5 rounded border-slate-300" />
                  <span className={`h-2 w-2 rounded-full ${PLATFORM_THEME[s.platform]?.dot || "bg-slate-300"}`} />
                  <span>{s.name}</span>
                  <span className="text-xs text-slate-400 ml-auto">{s.platform}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setPublishTarget(null)} className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">{t("取消", "Cancel")}</button>
              <button onClick={confirmPublish} className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:opacity-90">
                <Zap size={14} /> {t("确认加入发布清单", "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量调价 & 佣金对冲 */}
      {showBatchPrice && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowBatchPrice(false)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-sm font-medium"><Percent size={16} className="text-indigo-600" /> {t(`批量调价（已选 ${selectedRowIds.size} 项）`, `Batch Price Adjustment (${selectedRowIds.size} selected)`)}</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["percent", t("百分比调价", "Percent")],
                ["fixed", t("固定金额增减", "Fixed Amount")],
                ["set", t("统一固定价", "Set Uniform")],
                ["commission", t("佣金对冲", "Commission Hedge")],
              ].map(([mode, label]) => (
                <button key={mode} onClick={() => setBatchMode(mode)} className={`text-xs px-3 py-2 rounded-lg border ${batchMode === mode ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                  {label}
                </button>
              ))}
            </div>
            <div>
              <div className="text-xs text-slate-400 mb-1">
                {batchMode === "percent" && t("涨跌百分比（如 5 或 -20）", "Percent change (e.g. 5 or -20)")}
                {batchMode === "fixed" && t("固定增减金额 RM（如 3 或 -5）", "Fixed change in RM (e.g. 3 or -5)")}
                {batchMode === "set" && t("统一售价 RM", "Uniform price RM")}
                {batchMode === "commission" && t("佣金上涨百分点（如 2，代表 +2%）", "Commission increase in percentage points (e.g. 2 = +2%)")}
              </div>
              <input type="number" value={batchValue} onChange={(e) => setBatchValue(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              {batchMode === "commission" && (
                <div className="text-[11px] text-slate-400 mt-1">
                  {t("公式：新售价 = 原售价 ÷ (1 − 佣金涨幅%)，保持佣金扣除后的净收入不变（非简单加百分比）。", "Formula: newPrice = oldPrice ÷ (1 − commissionIncrease%) — keeps net-after-commission proceeds unchanged (not a naive flat percent bump).")}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowBatchPrice(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">{t("取消", "Cancel")}</button>
              <button onClick={applyBatchPrice} disabled={!batchValue} className={`flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg text-white ${batchValue ? "bg-gradient-to-r from-indigo-600 to-purple-600 hover:opacity-90" : "bg-slate-300 cursor-not-allowed"}`}>
                <Zap size={14} /> {t("应用并推送到已选店铺清单", "Apply to selected")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI 水印/爆款框架助手 */}
      {watermarkTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setWatermarkTarget(null)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-lg space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-sm font-medium text-indigo-700"><Sparkles size={16} /> {t(`AI 水印助手 — ${watermarkTarget.title}`, `AI Watermark — ${watermarkTarget.title}`)}</div>
            <div className="text-[11px] text-slate-400">
              {t("纯浏览器 Canvas 合成，不接入任何外部图像 AI 服务。", "Composited entirely in your browser via Canvas — no external image AI service involved.")}
            </div>
            <div>
              <div className="text-xs text-slate-400 mb-1">{t("选择框架模板", "Choose a frame")}</div>
              <div className="flex gap-2 flex-wrap">
                {AI_FRAME_TEMPLATES.map((tpl) => (
                  <button key={tpl.id} onClick={() => setWatermarkTemplate(tpl.id)} className={`text-xs px-3 py-1.5 rounded-lg border ${watermarkTemplate === tpl.id ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`} style={watermarkTemplate === tpl.id ? { borderColor: tpl.color } : {}}>
                    {tpl.icon} {t(tpl.zh, tpl.en)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => watermarkTarget.image_url && loadImageFromUrl(watermarkTarget.image_url)}
                disabled={!watermarkTarget.image_url}
                className={`text-xs px-3 py-2 rounded-lg border ${watermarkTarget.image_url ? "border-slate-200 hover:bg-slate-50" : "border-slate-100 text-slate-300 cursor-not-allowed"}`}
              >
                <ImageIcon size={13} className="inline mr-1" /> {t("使用现有主图", "Use existing image")}
              </button>
              <button onClick={() => fileInputRef.current?.click()} className="text-xs px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">
                <Upload size={13} className="inline mr-1" /> {t("上传本地图片", "Upload local image")}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
            </div>
            {watermarkError && <div className="text-xs text-rose-600">{watermarkError}</div>}
            <canvas ref={canvasRef} className="hidden" />
            {watermarkPreview && (
              <div className="border border-slate-200 rounded-lg p-2">
                <img src={watermarkPreview} alt="preview" className="w-full rounded-md" />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setWatermarkTarget(null)} className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">{t("取消", "Cancel")}</button>
              <button onClick={saveWatermark} disabled={!watermarkPreview} className={`flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg text-white ${watermarkPreview ? "bg-gradient-to-r from-emerald-500 to-teal-500 hover:opacity-90" : "bg-slate-300 cursor-not-allowed"}`}>
                <CheckCircle2 size={14} /> {t("保存并应用", "Save & Apply")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 多层级规格与 SKU 变体管理 */}
      {variationsTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setVariationsTarget(null)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-2xl space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-sm font-medium text-purple-700"><Layers size={16} /> {t(`规格与 SKU 变体 — ${variationsTarget.title}`, `Variations — ${variationsTarget.title}`)}</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-slate-400 mb-1">{t("规格1 名称（如 颜色）", "Spec 1 name (e.g. Color)")}</div>
                <input value={spec1Name} onChange={(e) => setSpec1Name(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg mb-1.5" />
                <div className="text-xs text-slate-400 mb-1">{t("规格1 值（逗号分隔，如 红色,蓝色,黑色）", "Spec 1 values (comma-separated)")}</div>
                <input value={spec1Values} onChange={(e) => setSpec1Values(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div>
                <div className="text-xs text-slate-400 mb-1">{t("规格2 名称（可选，如 尺寸）", "Spec 2 name (optional, e.g. Size)")}</div>
                <input value={spec2Name} onChange={(e) => setSpec2Name(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg mb-1.5" />
                <div className="text-xs text-slate-400 mb-1">{t("规格2 值（逗号分隔，如 S,M,L）", "Spec 2 values (comma-separated)")}</div>
                <input value={spec2Values} onChange={(e) => setSpec2Values(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
            </div>
            <button onClick={generateCombos} disabled={!spec1Values.trim()} className={`text-xs px-3 py-2 rounded-lg text-white ${spec1Values.trim() ? "bg-purple-600 hover:bg-purple-700" : "bg-slate-300 cursor-not-allowed"}`}>
              {t("生成组合", "Generate Combinations")}
            </button>
            {variationRows.length > 0 && (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs min-w-[560px]">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-slate-100">
                      <th className="py-2 px-2 font-medium">{t("规格组合", "Combination")}</th>
                      <th className="py-2 px-2 font-medium">{t("商家 SKU", "Seller SKU")}</th>
                      <th className="py-2 px-2 font-medium">{t("价格 (RM)", "Price (RM)")}</th>
                      <th className="py-2 px-2 font-medium">{t("库存", "Stock")}</th>
                      <th className="py-2 px-2 font-medium">{t("规格图片 URL", "Spec Image URL")}</th>
                      <th className="py-2 px-2 font-medium w-6" />
                    </tr>
                  </thead>
                  <tbody>
                    {variationRows.map((r, idx) => (
                      <tr key={idx} className="border-b border-slate-50 last:border-0">
                        <td className="py-1.5 px-2 whitespace-nowrap">{[r.spec1_value, r.spec2_value].filter(Boolean).join(" / ")}</td>
                        <td className="py-1.5 px-2"><input value={r.sku || ""} onChange={(e) => updateVariationField(idx, "sku", e.target.value)} className="w-24 px-1.5 py-1 border border-slate-200 rounded" /></td>
                        <td className="py-1.5 px-2"><input type="number" value={r.price} onChange={(e) => updateVariationField(idx, "price", e.target.value)} className="w-20 px-1.5 py-1 border border-slate-200 rounded" /></td>
                        <td className="py-1.5 px-2"><input type="number" value={r.stock} onChange={(e) => updateVariationField(idx, "stock", e.target.value)} className="w-16 px-1.5 py-1 border border-slate-200 rounded" /></td>
                        <td className="py-1.5 px-2"><input value={r.image_url || ""} onChange={(e) => updateVariationField(idx, "image_url", e.target.value)} className="w-36 px-1.5 py-1 border border-slate-200 rounded" /></td>
                        <td className="py-1.5 px-2"><button onClick={() => removeVariationRow(idx)} className="text-rose-400 hover:text-rose-600"><Trash2 size={13} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setVariationsTarget(null)} className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">{t("取消", "Cancel")}</button>
              <button onClick={saveVariations} className="text-sm px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700">{t("保存变体", "Save Variations")}</button>
            </div>
          </div>
        </div>
      )}

      {/* 类目库管理 — internal category_trees CRUD, see the note at the top
          of this file and above showCategoryManager for why this exists
          instead of a live official category picker. */}
      {showCategoryManager && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowCategoryManager(false)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-2xl space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-medium">{t("类目库管理（内部维护）", "Category Library (internal)")}</div>
            <div className="text-[11px] text-slate-400">
              {t("非官方实时同步，仅供内部级联选择器使用；待 Shopee/TikTok 商品 API 授权后可切换为真实类目树。", "Not a live official sync — used only for the internal cascading selector; can switch to the real category API once that scope is granted.")}
            </div>
            <div className="grid grid-cols-4 gap-2 items-end bg-slate-50 rounded-lg p-3">
              <div>
                <div className="text-[11px] text-slate-400 mb-1">{t("平台", "Platform")}</div>
                <select value={newCategory.platform} onChange={(e) => setNewCategory({ ...newCategory, platform: e.target.value })} className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white">
                  <option value="Shopee">Shopee</option>
                  <option value="TikTok Shop">TikTok Shop</option>
                </select>
              </div>
              <input value={newCategory.level1} onChange={(e) => setNewCategory({ ...newCategory, level1: e.target.value })} placeholder={t("第1级", "Level 1")} className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
              <input value={newCategory.level2} onChange={(e) => setNewCategory({ ...newCategory, level2: e.target.value })} placeholder={t("第2级", "Level 2")} className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
              <div className="flex gap-1">
                <input value={newCategory.level3} onChange={(e) => setNewCategory({ ...newCategory, level3: e.target.value })} placeholder={t("第3级", "Level 3")} className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                <button onClick={addCategoryLeaf} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800">{t("添加", "Add")}</button>
              </div>
            </div>
            <div className="space-y-2">
              {["Shopee", "TikTok Shop"].map((pf) => (
                <div key={pf}>
                  <div className="text-xs font-medium text-slate-500 mt-2 mb-1">{pf}</div>
                  {categoryTrees.filter((c) => c.platform === pf).length === 0 && (
                    <div className="text-[11px] text-slate-300">{t("暂无分类", "No categories yet")}</div>
                  )}
                  {categoryTrees.filter((c) => c.platform === pf).map((c) => (
                    <div key={c.id} className="border border-slate-100 rounded-lg mb-1.5">
                      <div className="flex items-center justify-between px-3 py-2 text-xs">
                        <button onClick={() => setExpandedLeafId(expandedLeafId === c.id ? null : c.id)} className="text-left flex-1 hover:text-indigo-600">
                          {c.level1} &gt; {c.level2} &gt; <span className="font-medium">{c.level3}</span>
                        </button>
                        <button onClick={() => deleteCategoryLeaf(c.id)} className="text-rose-400 hover:text-rose-600 ml-2"><Trash2 size={13} /></button>
                      </div>
                      {expandedLeafId === c.id && (
                        <div className="px-3 pb-2 border-t border-slate-50 pt-2">
                          <div className="text-[11px] text-slate-400 mb-1">{t("必填/选填属性模板", "Attribute Template")}</div>
                          <div className="space-y-1 mb-2">
                            {attributeTemplates.filter((a) => a.category_leaf_id === c.id).map((a) => (
                              <div key={a.id} className="flex items-center justify-between text-xs bg-slate-50 rounded px-2 py-1">
                                <span>{a.attr_name} {a.required ? <span className="text-rose-500">*</span> : <span className="text-slate-300">({t("选填", "optional")})</span>}</span>
                                <button onClick={() => deleteAttributeTemplate(a.id)} className="text-rose-400 hover:text-rose-600"><Trash2 size={12} /></button>
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <input value={newAttrName} onChange={(e) => setNewAttrName(e.target.value)} placeholder={t("属性名", "Attribute name")} className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded-lg" />
                            <label className="flex items-center gap-1 text-[11px] text-slate-500">
                              <input type="checkbox" checked={newAttrRequired} onChange={(e) => setNewAttrRequired(e.target.checked)} className="h-3 w-3 rounded border-slate-300" /> {t("必填", "Required")}
                            </label>
                            <button onClick={() => addAttributeTemplate(c.id)} className="text-xs px-2.5 py-1 rounded-lg bg-slate-900 text-white hover:bg-slate-800">{t("添加", "Add")}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={() => setShowCategoryManager(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">{t("关闭", "Close")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
