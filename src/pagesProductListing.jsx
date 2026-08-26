import { useState, useEffect, useRef } from "react";
import {
  Plus, Store, Percent, Sparkles, CheckCircle2, Bot, Zap,
  Image as ImageIcon, Upload, Layers, Trash2, Video, Truck, Camera, X, ArrowLeft, ChevronDown,
} from "lucide-react";
import { PLATFORM_THEME, DB_TO_DEMO_PLATFORM, fmt, supabaseClient } from "./shared.jsx";
import { KPICard as KPICardImpl } from "./pagesOverviewOrders.jsx";

// 平台物流渠道彻底隔离 (2026-08-24) — two separate fixed lists, one per
// platform, never merged/shown together. Real Malaysia courier names each
// platform actually supports; not fetched from a live logistics API for
// the seller's account (no such integration exists — see the file-top
// data-source note). TikTok's list intentionally excludes Shopee-only
// names (Shopee Xpress) and vice versa — no Lazada anywhere, this project
// has no Lazada integration at all.
const SHOPEE_SHIPPING_CHANNELS = ["Standard Delivery", "Shopee Xpress", "Poslaju", "J&T Express", "Ninja Van"];
const TIKTOK_SHIPPING_CHANNELS = ["J&T Express Malaysia", "Ninja Van", "Best Express", "DHL eCommerce"];

// 包裹重量快捷气泡 (2026-08-24) — common real parcel weights (grams) for a
// one-tap fill; staff can still type any value. Values are grams since
// small parts are usually weighed in g, not kg.
const WEIGHT_QUICK_PRESETS_G = [200, 250, 500, 1000, 2000, 5000];
const TITLE_MAX_LEN = 255; // real TikTok Shop product-title limit
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB — generous client-side guard, not a confirmed real TikTok limit
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB — generous client-side guard for photo uploads
const MAX_PRODUCT_IMAGES = 9; // real TikTok Shop product-image limit, per explicit request

// Malay -> English glossary for TikTok's real category names (2026-08-26,
// simplified per explicit request: English-only, no CN, no word-splitting).
// TikTok's real Category API only ever returns Malay local_name — no
// English field exists in the live response — so this is a static
// display-only lookup, not fabricated platform data. Keyed by lowercased/
// trimmed Malay name; unmapped names fall back to the raw Malay text
// rather than a guessed translation.
const TIKTOK_CATEGORY_EN_NAMES = {
  "bekalan rumah": "Home & Living",
  "peralatan dapur": "Kitchen Utensils",
  "tekstil & perabot lembut": "Textiles & Soft Furnishings",
  "automotif & motosikal": "Automotive & Motorcycle",
  "aksesori motosikal": "Motorcycle Accessories",
  "aksesori automotif": "Automotive Accessories",
  "topi keledar": "Helmet",
  "palam pencucuh": "Spark Plug",
  "penjagaan & aksesori kenderaan": "Vehicle Care & Accessories",
  "bahagian motosikal": "Motorcycle Parts",
  "elektronik kereta": "Car Electronics",
  "motosikal penghantaran manual": "Manual Transmission Motorcycle",
  "perkakas rumah": "Home Hardware",
  "pakaian & pakaian dalam wanita": "Women's Apparel & Underwear",
  "fesyen muslim": "Muslim Fashion",
  "kasut": "Shoes",
  "penjagaan diri": "Personal Care",
  "alat tulis": "Stationery",
  "haiwan peliharaan": "Pet Supplies",
  "jam tangan": "Watches",
  "barang kemas": "Jewellery",
  "seluar dalam": "Underwear",
  "sarung tangan": "Gloves",
  "baju kurung": "Baju Kurung",
};

// 商品发布中心 (2026-08-24) — data-source note, same spirit as the Ads
// Costs page's note: this is a real Supabase-backed feature
// (product_listings / product_listing_stores tables), but there is NO
// Shopee Product API integration in this project (only Order/Settlement/
// Fulfillment/Auth are connected — confirmed by inspecting every edge
// function before building this), so Shopee's category selector below
// still uses the internal category_trees library. "发布到店铺" and batch
// price adjustment only ever write to our own database, as a staging/
// tracking list — they never call a real platform API. publish_status=
// 'marked published' means a human confirmed they did it themselves on the
// real Shopee/TikTok seller center. This is a deliberate scope decision
// confirmed with the user 2026-08-24, not an oversight.
//
// TikTok's category selector is different (2026-08-24, updated same day):
// the user enabled Product scope (Global Category/Product Information) in
// TikTok Partner Center, so this page now calls the REAL
// GET /product/202309/categories and GET /product/202309/categories/
// {id}/attributes through tiktok-sync-orders (action: "tiktokCategories" /
// "tiktokCategoryAttributes"). Initially still failed with TikTok error
// 105005 (an existing shop's access_token only carries the scopes it was
// originally consented with; refreshing alone doesn't pick up a newly-
// enabled app scope). 2026-08-26 update: KSG completed a full OAuth
// reauth for an unrelated reason (Affiliate API access) and this was
// live-checked again — real category data now returns successfully
// (200 OK, genuine category tree), confirming the reauth also picked up
// the Product scope. The "needs re-auth" fallback code path below is kept
// (a shop that hasn't reauthorized since would still need it) but is no
// longer the expected outcome for KSG specifically.
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
  // 平台彻底解耦 (2026-08-25) — every listing form instance belongs to
  // exactly one platform ("Shopee" | "TikTok Shop"), set by whichever
  // /products/shopee/new or /products/tiktok/new entry point was used.
  // See openCreateListing/openEditListing and the full-page renderer below
  // for how this gates which category/brand/logistics section shows.
  platform: "",
  product_id: "", sku: "", title: "", description: "", category: "", image_urls: [], base_price: "", base_stock: "",
  brand: "No Brand", tiktok_brand_id: "", weight_kg: "", weight_unit: "kg", length_cm: "", width_cm: "", height_cm: "",
  is_dangerous: false, is_cod: false, video_url: "",
  shopee_shipping_channels: [], tiktok_shipping_channels: [], shopee_category_leaf_id: "", tiktok_category_leaf_id: "",
  tiktok_real_category_id: "",
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

  // 智能匹配分类 (2026-08-26, new) — real deterministic keyword-overlap
  // scoring against whichever category source is actually loaded (the real
  // TikTok tree once live, or the internal category_trees library for
  // Shopee / a not-yet-reauthorized TikTok shop). This is NOT a live
  // TikTok/Shopee "category prediction" API call — no such endpoint is
  // reachable with this app's connected scopes — so it's labeled "智能匹配
  // / Smart Match", not "AI", and only ever surfaces categories whose real
  // name text actually shares words with the typed title; it never
  // fabricates a suggestion out of nothing.
  function titleTokens(str) {
    return (str || "").toLowerCase().split(/[^a-z0-9一-鿿]+/).filter((w) => w.length > 1);
  }
  function overlapScore(tokens, text) {
    const pathTokens = titleTokens(text);
    return tokens.reduce((s, tok) => s + (pathTokens.some((pt) => pt.includes(tok) || tok.includes(pt)) ? 1 : 0), 0);
  }
  function suggestTiktokRealCategoryMatches(title) {
    const tokens = titleTokens(title);
    if (tokens.length === 0) return [];
    const norm = tiktokRealCategories.map(normalizeTikTokCategory);
    const byId = new Map(norm.map((c) => [c.id, c]));
    function pathOf(c) {
      const path = [c];
      let cur = c;
      while (cur.parentId && cur.parentId !== "0" && byId.has(cur.parentId)) {
        cur = byId.get(cur.parentId);
        path.unshift(cur);
      }
      return path;
    }
    const scored = norm
      .filter((c) => c.isLeaf)
      .map((leaf) => {
        const path = pathOf(leaf);
        return { path, score: overlapScore(tokens, path.map((p) => p.name).join(" ")) };
      })
      .filter((s) => s.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map((s) => ({
      l1id: s.path[0]?.id, l2id: s.path[1]?.id, leafId: s.path[s.path.length - 1]?.id,
      label: s.path.map((p) => p.name).join(" > "),
    }));
  }
  function suggestInternalCategoryMatches(title, platform) {
    const tokens = titleTokens(title);
    if (tokens.length === 0) return [];
    const scored = categoryTrees
      .filter((c) => c.platform === platform)
      .map((row) => ({ row, score: overlapScore(tokens, `${row.level1} ${row.level2} ${row.level3}`) }))
      .filter((s) => s.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map((s) => ({ row: s.row, label: `${s.row.level1} > ${s.row.level2} > ${s.row.level3}` }));
  }
  // Applies one suggestion — routes to whichever category system is
  // currently active for this platform, same setters the manual dropdowns
  // above already use, so a suggestion click is indistinguishable from a
  // human picking the same path by hand (including real attribute loading
  // for the TikTok-real path via selectTiktokRealLeaf).
  function applyCategorySuggestion(platform, suggestion) {
    if (platform === "TikTok Shop" && tiktokApiStatus === "ok") {
      setTiktokRealL1(suggestion.l1id || "");
      setTiktokRealL2(suggestion.l2id || "");
      selectTiktokRealLeaf(suggestion.leafId || "");
      return;
    }
    const { row } = suggestion;
    if (platform === "Shopee") {
      setShopeeL1(row.level1); setShopeeL2(row.level2);
      selectLeaf("shopee_category_leaf_id", row.id);
    } else {
      setTiktokL1(row.level1); setTiktokL2(row.level2);
      selectLeaf("tiktok_category_leaf_id", row.id);
    }
  }

  // ---- TikTok 真实类目 API (2026-08-24, new) — see the file-top note for
  // the full story: real endpoints, currently blocked by 105005 on every
  // shop connected before the Product scope was enabled, until each shop is
  // re-authorized. This block tries the real API first; Shopee has no such
  // integration and keeps using the internal library above unconditionally.
  const [tiktokApiStatus, setTiktokApiStatus] = useState("idle"); // idle | loading | ok | error
  const [tiktokApiError, setTiktokApiError] = useState(null); // { message, needsReauth }
  const [tiktokRealCategories, setTiktokRealCategories] = useState([]); // flat list, real TikTok response
  const [tiktokRealL1, setTiktokRealL1] = useState("");
  const [tiktokRealL2, setTiktokRealL2] = useState("");
  const [tiktokRealAttrsLoading, setTiktokRealAttrsLoading] = useState(false);
  const [tiktokRealAttrs, setTiktokRealAttrs] = useState([]); // real per-category attribute defs

  // Reads the real error/needsReauth out of a non-2xx tiktok-sync-orders
  // response — same reason as callStaffApi in this app's Roles page:
  // supabase-js's functions.invoke() only gives a generic error by default.
  async function callTikTokProductApi(action, extra) {
    const { data, error } = await supabaseClient.functions.invoke("tiktok-sync-orders", { body: { action, ...extra } });
    if (error) {
      let message = error.message;
      let needsReauth = false;
      try {
        if (error.context && typeof error.context.json === "function") {
          const body = await error.context.json();
          if (body?.error) message = body.error;
          needsReauth = !!body?.needsReauth;
        }
      } catch { /* fall back to the generic message */ }
      return { data: null, error: message, needsReauth };
    }
    if (data?.error) return { data: null, error: data.error, needsReauth: !!data.needsReauth };
    return { data: data?.data, error: null, needsReauth: false };
  }

  // Real TikTok category rows don't have confirmed field names in this
  // session (every live check so far has hit 105005 before returning real
  // data) — normalized defensively across the field names TikTok's docs use
  // (local_name/name, parent_id, is_leaf/leaf). Spot-check this once a shop
  // is re-authorized and adjust if the real shape differs.
  //
  // Display translation (2026-08-26, new) — TikTok's real category API only
  // ever returns the Malay local_name (no EN/CN fields exist in the real
  // response), so a manually-curated CN/EN glossary is used to translate
  // known names for display. Unknown names honestly fall back to the
  // original Malay text rather than guessing a translation. The real
  // official category_id (rawName's `id`) is never altered by this — only
  // the label shown to staff changes.
  function normalizeTikTokCategory(c) {
    const rawName = c.local_name || c.name || c.category_name || "Unnamed category";
    return {
      id: String(c.id ?? c.category_id ?? ""),
      parentId: c.parent_id != null ? String(c.parent_id) : (c.parentId != null ? String(c.parentId) : "0"),
      name: TIKTOK_CATEGORY_EN_NAMES[rawName.trim().toLowerCase()] || rawName,
      rawName,
      isLeaf: !!(c.is_leaf ?? c.leaf ?? false),
    };
  }
  function tiktokRealOptions(level, l1id, l2id) {
    const norm = tiktokRealCategories.map(normalizeTikTokCategory);
    if (level === 1) return norm.filter((c) => c.parentId === "0" || !c.parentId);
    if (level === 2) return norm.filter((c) => c.parentId === l1id);
    return norm.filter((c) => c.parentId === l2id);
  }

  async function loadTiktokRealCategories() {
    const tiktokStore = (stores || []).find((s) => s.platform === "TikTok Shop");
    if (!tiktokStore) {
      setTiktokApiStatus("error");
      setTiktokApiError({ message: t("暂无已连接的 TikTok 店铺", "No connected TikTok store"), needsReauth: false });
      return;
    }
    setTiktokApiStatus("loading");
    const { data, error, needsReauth } = await callTikTokProductApi("tiktokCategories", { platformAccountId: tiktokStore.id });
    if (error) {
      setTiktokApiStatus("error");
      setTiktokApiError({ message: error, needsReauth });
      return;
    }
    const list = data?.categories || data?.category_list || (Array.isArray(data) ? data : []);
    setTiktokRealCategories(Array.isArray(list) ? list : []);
    setTiktokApiStatus("ok");
  }

  async function selectTiktokRealLeaf(leafId) {
    const tiktokStore = (stores || []).find((s) => s.platform === "TikTok Shop");
    setListingForm((prev) => ({ ...prev, tiktok_real_category_id: leafId, tiktok_category_leaf_id: "" }));
    if (!leafId || !tiktokStore) { setTiktokRealAttrs([]); return; }
    setTiktokRealAttrsLoading(true);
    const { data, error } = await callTikTokProductApi("tiktokCategoryAttributes", { platformAccountId: tiktokStore.id, categoryId: leafId });
    setTiktokRealAttrsLoading(false);
    if (error) { setTiktokRealAttrs([]); return; }
    const attrs = data?.attributes || (Array.isArray(data) ? data : []);
    setTiktokRealAttrs(attrs);
    // Enumerable option values (2026-08-27, new) — TikTok's real attribute
    // response includes a `values` list ({id, name}) for SINGLE_SELECT/
    // MULTIPLE_SELECT attribute types; captured here so the row below can
    // render a clean dropdown instead of a free-text box, with "Enter a
    // custom value" as an explicit escape hatch for any name not in the
    // list. Attributes with no such list keep the plain text input.
    const templateNames = attrs.map((a) => ({
      name: a.name || a.attribute_name || "",
      required: a.is_requried ?? a.required ?? false,
      options: Array.isArray(a.values) ? a.values.map((v) => v.name || v.value || String(v)).filter(Boolean) : [],
    })).filter((a) => a.name);
    setListingForm((prev) => {
      const existingNames = new Set(prev.attributes.map((a) => a.name));
      const added = templateNames.filter((a) => !existingNames.has(a.name)).map((a) => ({ name: a.name, value: "", options: a.options }));
      return { ...prev, attributes: [...prev.attributes, ...added] };
    });
  }

  // ---- TikTok 原生级联类目选择器 (2026-08-26, new) — replaces the plain
  // 3-dropdown UI with TikTok Shop's own "All categories" cascade panel
  // style: a search bar, then side-by-side columns (L1 on the left, its
  // children to the right, drilling further right as you go deeper), and
  // a trigger button showing the full official path once a leaf is picked
  // (e.g. "Automotive & Motorcycle > Motorcycle Parts > Shocks, Struts &
  // Suspension"). Pure UI/UX refactor — reuses tiktokRealOptions/
  // normalizeTikTokCategory/selectTiktokRealLeaf exactly as before, no
  // change to the real category-tree depth assumption or attribute-load
  // logic (see selectTiktokRealLeaf above for the real
  // tiktokCategoryAttributes call this still triggers on leaf pick).
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [categorySearchQuery, setCategorySearchQuery] = useState("");
  const categoryPickerRef = useRef(null);
  useEffect(() => {
    function handleClickOutside(e) {
      if (categoryPickerRef.current && !categoryPickerRef.current.contains(e.target)) {
        setShowCategoryPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  // Real official path label for whichever leaf is currently selected —
  // shown on the trigger button, same normalizeTikTokCategory field names
  // the rest of this picker already relies on.
  function tiktokRealSelectedPathLabel() {
    if (!listingForm.tiktok_real_category_id) return "";
    const norm = tiktokRealCategories.map(normalizeTikTokCategory);
    const byId = new Map(norm.map((c) => [c.id, c]));
    const leaf = byId.get(listingForm.tiktok_real_category_id);
    if (!leaf) return "";
    const path = [leaf];
    let cur = leaf;
    while (cur.parentId && cur.parentId !== "0" && byId.has(cur.parentId)) {
      cur = byId.get(cur.parentId);
      path.unshift(cur);
    }
    return path.map((c) => c.name).join(" > ");
  }
  // Search-all-categories (2026-08-26, new) — TikTok's own picker lets you
  // type instead of drilling through columns; searches every real leaf's
  // full path text (not just the leaf's own name — matches TikTok's own
  // "type any word in the path" search behavior), plain substring match
  // since this is a manual search box, not the separate AI/smart-match
  // suggestion feature built earlier.
  function searchTiktokRealLeaves(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const norm = tiktokRealCategories.map(normalizeTikTokCategory);
    const byId = new Map(norm.map((c) => [c.id, c]));
    function pathOf(c) {
      const path = [c];
      let cur = c;
      while (cur.parentId && cur.parentId !== "0" && byId.has(cur.parentId)) {
        cur = byId.get(cur.parentId);
        path.unshift(cur);
      }
      return path;
    }
    return norm
      .filter((c) => c.isLeaf)
      .map((leaf) => ({ leaf, path: pathOf(leaf) }))
      .filter(({ path }) => path.some((p) => p.name.toLowerCase().includes(q) || p.rawName.toLowerCase().includes(q)))
      .slice(0, 30)
      .map(({ leaf, path }) => ({ l1id: path[0]?.id, l2id: path[1]?.id, leafId: leaf.id, label: path.map((p) => p.name).join(" > ") }));
  }
  function pickCategoryFromCascade(l1id, l2id, leafId) {
    setTiktokRealL1(l1id || "");
    setTiktokRealL2(l2id || "");
    selectTiktokRealLeaf(leafId || "");
    if (leafId) { setShowCategoryPicker(false); setCategorySearchQuery(""); }
  }

  // ---- TikTok 官方品牌库 (2026-08-24, new) — same real-API-first,
  // graceful-fallback pattern as categories: succeeds once a shop is
  // re-authorized (see file-top note), falls back to the existing free-text
  // `brand` input otherwise.
  const [tiktokBrandsStatus, setTiktokBrandsStatus] = useState("idle"); // idle | loading | ok | error
  const [tiktokRealBrands, setTiktokRealBrands] = useState([]);
  // Searchable brand picker (2026-08-27, new) — replaces the plain
  // <select> with a TikTok-style search + list panel; reuses the same
  // click-outside pattern as categoryPickerRef/aiKeywordWrapRef above.
  const [showBrandPicker, setShowBrandPicker] = useState(false);
  const [brandSearchQuery, setBrandSearchQuery] = useState("");
  const brandPickerRef = useRef(null);
  useEffect(() => {
    function handleClickOutside(e) {
      if (brandPickerRef.current && !brandPickerRef.current.contains(e.target)) setShowBrandPicker(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  function pickTiktokBrand(b) {
    const id = String(b.id ?? b.brand_id ?? "");
    setListingForm((prev) => ({ ...prev, tiktok_brand_id: id, brand: b.name || b.brand_name || id }));
    setShowBrandPicker(false);
    setBrandSearchQuery("");
  }
  function chooseNoBrand() {
    setListingForm((prev) => ({ ...prev, tiktok_brand_id: "", brand: "No Brand" }));
    setShowBrandPicker(false);
    setBrandSearchQuery("");
  }
  function addCustomBrand() {
    const name = brandSearchQuery.trim();
    if (!name) return;
    // Not a real TikTok brand-library submission (no such write endpoint
    // exists) — sets the free-text brand field to this name, same as
    // manually typing it, just reachable from this panel's footer per the
    // explicit request.
    setListingForm((prev) => ({ ...prev, tiktok_brand_id: "", brand: name }));
    setShowBrandPicker(false);
    setBrandSearchQuery("");
  }
  async function loadTiktokRealBrands() {
    const tiktokStore = (stores || []).find((s) => s.platform === "TikTok Shop");
    if (!tiktokStore) { setTiktokBrandsStatus("error"); return; }
    setTiktokBrandsStatus("loading");
    const { data, error } = await callTikTokProductApi("tiktokBrands", { platformAccountId: tiktokStore.id });
    if (error) { setTiktokBrandsStatus("error"); return; }
    const list = data?.brands || (Array.isArray(data) ? data : []);
    setTiktokRealBrands(Array.isArray(list) ? list : []);
    setTiktokBrandsStatus("ok");
  }

  // ---- 商品视频上传 (2026-08-24, new) — real upload to the product-videos
  // Storage bucket (public read, authenticated write — see migration), not
  // a data: URL like the watermark image (videos are too large for that).
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoError, setVideoError] = useState("");
  async function handleVideoUpload(file) {
    if (!file) return;
    if (!file.type.startsWith("video/")) { setVideoError(t("请上传视频文件", "Please upload a video file")); return; }
    if (file.size > MAX_VIDEO_BYTES) { setVideoError(t("视频文件过大（上限 100MB）", "Video file too large (100MB max)")); return; }
    setVideoError("");
    setVideoUploading(true);
    const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error } = await supabaseClient.storage.from("product-videos").upload(path, file, { upsert: false });
    setVideoUploading(false);
    if (error) { setVideoError(t("上传失败", "Upload failed")); console.error("video upload failed", error); return; }
    const { data: pub } = supabaseClient.storage.from("product-videos").getPublicUrl(path);
    setListingForm((prev) => ({ ...prev, video_url: pub.publicUrl }));
  }

  // ---- 主图相册上传 (2026-08-24, new) — real upload to the product-images
  // Storage bucket, same pattern as handleVideoUpload above. Replaces the
  // old URL-paste input entirely; both the camera-capture and local-photo
  // pickers funnel through this same function (the <input>'s capture
  // attribute is what makes one open the camera vs. the gallery).
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState("");
  async function handleImageFiles(fileList) {
    let files = Array.from(fileList || []);
    if (files.length === 0) return;
    setImageError("");
    // MAX_PRODUCT_IMAGES cap (2026-08-26, new) — TikTok Shop's own real
    // per-listing image limit, per explicit request. Truncates the batch
    // rather than rejecting it outright, so selecting e.g. 5 photos with
    // only 3 slots left still uploads those 3 instead of uploading none.
    const remaining = MAX_PRODUCT_IMAGES - listingForm.image_urls.length;
    if (remaining <= 0) {
      setImageError(t(`最多只能上传 ${MAX_PRODUCT_IMAGES} 张图片`, `You can upload up to ${MAX_PRODUCT_IMAGES} images`));
      return;
    }
    if (files.length > remaining) {
      setImageError(t(`最多只能上传 ${MAX_PRODUCT_IMAGES} 张图片，已只取前 ${remaining} 张`, `You can upload up to ${MAX_PRODUCT_IMAGES} images — only the first ${remaining} were used`));
      files = files.slice(0, remaining);
    }
    setImageUploading(true);
    const uploaded = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) { setImageError(t("请上传照片文件", "Please upload a photo")); continue; }
      if (file.size > MAX_IMAGE_BYTES) { setImageError(t("照片过大（单张上限 20MB）", "Photo too large (20MB max each)")); continue; }
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error } = await supabaseClient.storage.from("product-images").upload(path, file, { upsert: false });
      if (error) { setImageError(t("上传失败", "Upload failed")); console.error("image upload failed", error); continue; }
      const { data: pub } = supabaseClient.storage.from("product-images").getPublicUrl(path);
      uploaded.push(pub.publicUrl);
    }
    setImageUploading(false);
    if (uploaded.length > 0) {
      setListingForm((prev) => ({ ...prev, image_urls: [...prev.image_urls, ...uploaded] }));
    }
  }
  function removeImageAt(idx) {
    setListingForm((prev) => ({ ...prev, image_urls: prev.image_urls.filter((_, i) => i !== idx) }));
  }

  // 图片拖拽排序 (2026-08-26, new) — native HTML5 Drag & Drop API rather
  // than a new dependency (@hello-pangea/dnd etc.) — same "don't pull in a
  // library for one feature" convention this file already follows for
  // routing (see the history.pushState comment above). image_urls[0] is
  // already the real field saveListing() sends as the payload's main
  // `image_url` (line ~533's own comment: "image_urls is the real ordered
  // gallery"), so reordering this array is the entire fix — no separate
  // "main image" field/state needed, dragging a thumbnail to slot 1
  // IS what makes it the cover image on submit.
  const [draggedImageIdx, setDraggedImageIdx] = useState(null);
  const [dragOverImageIdx, setDragOverImageIdx] = useState(null);
  function reorderImages(fromIdx, toIdx) {
    if (fromIdx === toIdx) return;
    setListingForm((prev) => {
      const next = [...prev.image_urls];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { ...prev, image_urls: next };
    });
  }

  // ---- 新建/编辑主商品发布清单 ----
  const [showListingForm, setShowListingForm] = useState(false);
  const [editingListingId, setEditingListingId] = useState(null);
  const [listingForm, setListingForm] = useState(emptyListingForm);

  // ---- 详情描述富文本编辑器 + 内嵌图片上传 (2026-08-26, new) — a plain
  // contentEditable div rather than a new rich-text-editor dependency
  // (matches this file's existing "no new library for one feature"
  // convention — see the history.pushState routing comment below).
  // listingForm.description now stores HTML (was plain text) so an
  // inserted <img> can live inline with the text; a plain-text description
  // saved before this change still displays fine (valid HTML, just no
  // markup). Uncontrolled by design: the div's real DOM content is the
  // source of truth while typing (onInput just mirrors it into state for
  // saving), and is only ever force-synced from state when the form opens
  // or switches which listing is being edited (see the effect below) —
  // syncing on every keystroke would fight the browser's own cursor
  // position and undo history.
  const descriptionEditorRef = useRef(null);
  const [descImageUploading, setDescImageUploading] = useState(false);
  const [descImageError, setDescImageError] = useState("");
  useEffect(() => {
    if (showListingForm && descriptionEditorRef.current) {
      descriptionEditorRef.current.innerHTML = listingForm.description || "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showListingForm, editingListingId]);
  function syncDescriptionFromEditor() {
    setListingForm((prev) => ({ ...prev, description: descriptionEditorRef.current?.innerHTML || "" }));
  }
  async function insertDescriptionImage(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setDescImageError(t("请上传照片文件", "Please upload a photo")); return; }
    if (file.size > MAX_IMAGE_BYTES) { setDescImageError(t("照片过大（单张上限 20MB）", "Photo too large (20MB max each)")); return; }
    setDescImageError("");
    setDescImageUploading(true);
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error } = await supabaseClient.storage.from("product-images").upload(path, file, { upsert: false });
    setDescImageUploading(false);
    if (error) { setDescImageError(t("上传失败", "Upload failed")); console.error("description image upload failed", error); return; }
    const { data: pub } = supabaseClient.storage.from("product-images").getPublicUrl(path);
    const editor = descriptionEditorRef.current;
    if (editor) {
      editor.focus();
      // Bounded size (2026-08-26, explicit request) — object-fit: contain
      // keeps the real aspect ratio instead of stretching/cropping; a
      // trailing <br> after the wrapper guarantees the caret always has a
      // real text line to land on directly below the image, since some
      // browsers otherwise trap the cursor at the image's edge.
      document.execCommand(
        "insertHTML",
        false,
        `<span class="desc-img-wrap" contenteditable="false" style="position:relative;display:inline-block;max-width:100%;margin:4px 0;">` +
          `<img src="${pub.publicUrl}" style="display:block;max-width:100%;max-height:300px;object-fit:contain;border-radius:8px;" />` +
          `<button type="button" class="desc-img-del" contenteditable="false" style="position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:9999px;border:none;background:rgba(15,23,42,0.65);color:#fff;font-size:12px;line-height:20px;text-align:center;cursor:pointer;opacity:0;transition:opacity .15s;">✕</button>` +
        `</span><br>`,
      );
      syncDescriptionFromEditor();
    }
  }
  // Hover-to-reveal delete + click-to-remove for inserted description
  // images (2026-08-26, explicit request) — event delegation on the editor
  // container so it keeps working for images inserted at any point, not
  // just ones present when the listener was attached.
  function handleDescriptionEditorMouseOver(e) {
    const wrap = e.target.closest?.(".desc-img-wrap");
    if (wrap) { const btn = wrap.querySelector(".desc-img-del"); if (btn) btn.style.opacity = "1"; }
  }
  function handleDescriptionEditorMouseOut(e) {
    const wrap = e.target.closest?.(".desc-img-wrap");
    if (wrap) { const btn = wrap.querySelector(".desc-img-del"); if (btn) btn.style.opacity = "0"; }
  }
  function handleDescriptionEditorClick(e) {
    if (e.target.classList?.contains("desc-img-del")) {
      e.preventDefault();
      e.target.closest(".desc-img-wrap")?.remove();
      syncDescriptionFromEditor();
    }
  }
  // Paste-image support (2026-08-26, new) — intercepts an image pasted
  // directly from the clipboard (e.g. a screenshot) and uploads it the
  // same real way as the toolbar button, instead of silently pasting a
  // giant base64 data: URI into the HTML (which would bloat the saved
  // description and never survive a real TikTok/Shopee API's size limits).
  function handleDescriptionPaste(e) {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find((it) => it.type.startsWith("image/"));
    if (!imageItem) return; // let normal text paste through
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (file) insertDescriptionImage(file);
  }

  // ---- AI 标题/描述生成 (2026-08-26, new) — real Anthropic Messages API
  // call via the new ai-generate Edge Function, not a template/fake
  // response (see that function's own comment). Both buttons share the
  // same real category label + attributes context so the model has
  // whatever the seller has actually filled in so far, real leaf category
  // name preferred over the free-text 分类 field when a real one is
  // selected (TikTok-real tree, then the internal category_trees library).
  const [aiTitleLoading, setAiTitleLoading] = useState(false);
  const [aiDescLoading, setAiDescLoading] = useState(false);
  function currentCategoryLabel() {
    if (listingForm.tiktok_real_category_id && tiktokRealCategories.length > 0) {
      const norm = tiktokRealCategories.map(normalizeTikTokCategory);
      const leaf = norm.find((c) => c.id === listingForm.tiktok_real_category_id);
      if (leaf) return leaf.name;
    }
    const leafId = listingForm.tiktok_category_leaf_id || listingForm.shopee_category_leaf_id;
    if (leafId) {
      const leaf = categoryTrees.find((c) => c.id === leafId);
      if (leaf) return `${leaf.level1} > ${leaf.level2} > ${leaf.level3}`;
    }
    return listingForm.category || "";
  }
  // Extracts the real error string out of a supabaseClient.functions.invoke()
  // result — supabase-js only gives a generic "non-2xx" message by default,
  // the real one lives in error.context's response body (same pattern
  // callTikTokProductApi above already established for TikTok errors).
  async function extractInvokeError(error, data) {
    if (data?.error) return data.error;
    if (error) {
      try { return (await error.context?.json())?.error; } catch { /* fall back below */ }
    }
    return null;
  }
  // AI 标题关键词推荐 (2026-08-26, refined from a plain title-rewrite) —
  // calls the real ai-generate Edge Function's "keywords" action. HONESTY
  // NOTE (see that function's own comment for the full explanation): this
  // project has no real integration to TikTok/Shopee's buyer-search or
  // competitor-listing data, so these are Claude's own inferred keyword
  // guesses, not live platform analytics — labeled as such in the dropdown
  // UI below ("AI 推荐，非实时平台数据"), never presented as real search
  // volume.
  const [aiKeywordSuggestions, setAiKeywordSuggestions] = useState(null); // { trending: [], competitor: [] } | null
  const [showAiKeywordDropdown, setShowAiKeywordDropdown] = useState(false);
  // 离线智能生成兜底 (2026-08-26, new) — a real, deterministic, purely
  // local keyword-expansion algorithm (no network call, can never fail or
  // be blocked by a missing ANTHROPIC_API_KEY). Same honesty boundary as
  // the real ai-generate call: this is rule-based expansion of the
  // seed word using common Malaysian marketplace listing vocabulary, not
  // real TikTok/Shopee search-volume or competitor data — the dropdown UI
  // labels both this and the real-AI path identically ("AI 推荐，非实时
  //平台数据") since neither is ever real live platform analytics.
  const BUYER_SEARCH_MODIFIERS = ["original", "murah", "harga borong", "ready stock", "terbaru", "set lengkap", "COD", "berkualiti tinggi"];
  const COMPETITOR_TITLE_MODIFIERS = ["High Quality", "Premium", "Universal Fit", "Heavy Duty", "Waterproof", "SIRIM Approved", "3 Snap", "Anti Fog"];
  function generateFallbackKeywords(title, category) {
    const seedPhrase = (title || category || "").trim();
    const catWord = titleTokens(category)[0] || "";
    const trending = [];
    const competitor = [];
    for (const m of BUYER_SEARCH_MODIFIERS) {
      if (trending.length >= 8) break;
      const phrase = `${seedPhrase} ${m}`.trim();
      if (phrase && !trending.includes(phrase)) trending.push(phrase);
    }
    if (catWord && !trending.some((p) => p.toLowerCase() === catWord.toLowerCase())) trending.unshift(catWord);
    for (const m of COMPETITOR_TITLE_MODIFIERS) {
      if (competitor.length >= 8) break;
      const phrase = `${seedPhrase} ${m}`.trim();
      if (phrase && !competitor.includes(phrase)) competitor.push(phrase);
    }
    // seed carried alongside the badges (2026-08-26, new) — appendTitleKeyword
    // needs to know exactly what prefix each badge was built on, so it can
    // strip that prefix back off before appending rather than re-appending
    // the whole seed every time a badge is clicked (which would duplicate
    // it further on every click after the first, since the title itself
    // grows/changes after each click while every badge in this batch was
    // generated against the ORIGINAL seed, not the current title).
    return { trending: trending.slice(0, 8), competitor: competitor.slice(0, 8), seed: seedPhrase };
  }
  async function generateAiTitleKeywords() {
    if (!listingForm.title.trim() && !currentCategoryLabel()) {
      showToast(t("请先输入商品标题关键词或选择分类", "Enter a seed keyword or select a category first"));
      return;
    }
    setAiTitleLoading(true);
    // Real AI first (in case ANTHROPIC_API_KEY is configured, for
    // genuinely better results); any failure — missing key, network error,
    // rate limit, anything — falls straight back to the local generator
    // below instead of erroring, so this button can never fail or block.
    try {
      const { data, error } = await supabaseClient.functions.invoke("ai-generate", {
        body: { action: "keywords", title: listingForm.title, category: currentCategoryLabel(), brand: listingForm.brand },
      });
      const errMessage = await extractInvokeError(error, data);
      if (errMessage) throw new Error(errMessage);
      // Real-AI keywords are standalone short phrases (see ai-generate's
      // own system prompt), not "seed + modifier" concatenations, so no
      // seed-prefix to strip on click — seed: "" makes appendTitleKeyword's
      // startsWith check below a no-op for this batch, same as before.
      setAiKeywordSuggestions({ trending: data.trending || [], competitor: data.competitor || [], seed: "" });
    } catch (e) {
      console.error("generateAiTitleKeywords: real AI call failed, using offline fallback", e);
      setAiKeywordSuggestions(generateFallbackKeywords(listingForm.title, currentCategoryLabel()));
    }
    setAiTitleLoading(false);
    setShowAiKeywordDropdown(true);
  }
  // Appends a clicked keyword badge to the title (space-separated, no
  // duplicate append if that exact word/phrase is already present) —
  // dropdown stays open so multiple badges can be clicked in sequence to
  // build up one SEO-friendly title, per the explicit multi-select request.
  function appendTitleKeyword(word, seedUsed) {
    setListingForm((prev) => {
      const existing = prev.title.trim();
      if (!word) return prev;
      // The offline fallback's own badges are built as "seed + modifier"
      // (see generateFallbackKeywords above), so every badge in a batch
      // carries the SAME seed prefix — strip it back off here before
      // appending, using the seed the batch actually recorded (not the
      // current title, which may have already grown from earlier clicks).
      // Without this, a second badge click would re-append the whole seed
      // a second time on top of what the first click already produced.
      // Real-AI badges pass seedUsed: "" (standalone phrases, no prefix to
      // strip), so this is a no-op for them — same as before.
      let toAppend = word;
      if (seedUsed && word.toLowerCase().startsWith(seedUsed.toLowerCase())) {
        toAppend = word.slice(seedUsed.length).trim();
      }
      if (!toAppend) return prev;
      if (existing.toLowerCase().includes(toAppend.toLowerCase())) return prev; // already present, no-op
      const nextTitle = (existing ? `${existing} ${toAppend}` : toAppend).slice(0, TITLE_MAX_LEN);
      return { ...prev, title: nextTitle };
    });
  }
  // Click-outside-to-close for the keyword dropdown (2026-08-26, new) —
  // same pattern as the order search auto-suggest dropdown built earlier
  // this session (pagesOverviewOrders.jsx).
  const aiKeywordWrapRef = useRef(null);
  useEffect(() => {
    function handleClickOutside(e) {
      if (aiKeywordWrapRef.current && !aiKeywordWrapRef.current.contains(e.target)) {
        setShowAiKeywordDropdown(false);
        setShowTitleSuggestDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  // Deterministic offline fallback (2026-08-26, explicit request — mirrors
  // generateFallbackKeywords' "never fails or blocks" discipline) — a
  // template built from whatever the seller has actually filled in
  // (title/category/brand/attributes), not a real AI call. Used only when
  // the real ai-generate call fails (e.g. ANTHROPIC_API_KEY not configured).
  function generateFallbackDescription(title, category, brand, attributes) {
    const name = title || category || t("本商品", "This product");
    const bulletSource = (attributes || []).filter((a) => a.name?.trim());
    const bullets = bulletSource.length
      ? bulletSource.map((a) => `<li>${a.name}${a.value ? `: ${a.value}` : ""}</li>`).join("")
      : t("<li>做工精细，品质可靠</li><li>适用范围广，性价比高</li>", "<li>Well-made and reliable</li><li>Wide compatibility, great value</li>");
    return t(
      `<p><strong>${name}</strong>${brand ? ` — ${brand}` : ""}${category ? `，属于「${category}」类目` : ""}。</p><ul>${bullets}</ul><p>欢迎选购，如有疑问请联系客服。</p>`,
      `<p><strong>${name}</strong>${brand ? ` by ${brand}` : ""}${category ? ` — ${category}` : ""}.</p><ul>${bullets}</ul><p>Feel free to reach out with any questions before you order.</p>`,
    );
  }
  async function generateAiDescription() {
    if (!listingForm.title.trim() && !currentCategoryLabel()) {
      showToast(t("请先输入商品标题或选择分类", "Enter a title or select a category first"));
      return;
    }
    setAiDescLoading(true);
    const { data, error } = await supabaseClient.functions.invoke("ai-generate", {
      body: { action: "description", title: listingForm.title, category: currentCategoryLabel(), brand: listingForm.brand, attributes: listingForm.attributes },
    });
    setAiDescLoading(false);
    const errMessage = await extractInvokeError(error, data);
    const html = errMessage
      ? generateFallbackDescription(listingForm.title, currentCategoryLabel(), listingForm.brand, listingForm.attributes)
      : data.html;
    if (errMessage) console.error("generateAiDescription failed, using offline fallback", errMessage);
    setListingForm((prev) => ({ ...prev, description: html }));
    if (descriptionEditorRef.current) descriptionEditorRef.current.innerHTML = html;
  }

  // ---- Title "+suggestions": 3 alternative full titles (2026-08-27, new)
  // — real Gemini/Anthropic call via ai-generate's "title_suggestions"
  // action (see that function's provider-selection comment); on any
  // failure falls back to 3 local deterministic variations built from
  // generateFallbackKeywords' modifiers, so the dropdown always has
  // something to click even offline.
  const [aiTitleSuggestLoading, setAiTitleSuggestLoading] = useState(false);
  const [titleSuggestions, setTitleSuggestions] = useState([]);
  const [showTitleSuggestDropdown, setShowTitleSuggestDropdown] = useState(false);
  function fallbackTitleSuggestions(title, category) {
    const fb = generateFallbackKeywords(title, category);
    const seed = fb.seed || title || category || t("商品", "Product");
    return [fb.trending[0], fb.competitor[0], fb.trending[1] || fb.competitor[1]]
      .filter(Boolean)
      .map((mod) => `${seed} ${mod}`.trim())
      .slice(0, 3);
  }
  async function generateAiTitleSuggestions() {
    if (!listingForm.title.trim() && !currentCategoryLabel()) {
      showToast(t("请先输入商品标题或选择分类", "Enter a title or select a category first"));
      return;
    }
    setAiTitleSuggestLoading(true);
    const { data, error } = await supabaseClient.functions.invoke("ai-generate", {
      body: { action: "title_suggestions", title: listingForm.title, category: currentCategoryLabel(), brand: listingForm.brand },
    });
    setAiTitleSuggestLoading(false);
    const errMessage = await extractInvokeError(error, data);
    const titles = errMessage || !data?.titles?.length
      ? fallbackTitleSuggestions(listingForm.title, currentCategoryLabel())
      : data.titles;
    if (errMessage) console.error("generateAiTitleSuggestions failed, using offline fallback", errMessage);
    setTitleSuggestions(titles);
    setShowTitleSuggestDropdown(true);
  }
  function applyTitleSuggestion(title) {
    setListingForm((prev) => ({ ...prev, title: title.slice(0, TITLE_MAX_LEN) }));
    setShowTitleSuggestDropdown(false);
  }

  // ---- Category & Brand "+suggestions" (2026-08-27, new) — real Gemini/
  // Anthropic call via ai-generate's "category_brand_suggest" action,
  // guessing a plausible category/brand name from the title alone. The
  // suggested category NAME is matched onto a real category via the
  // existing keyword-overlap suggestTiktokRealCategoryMatches/
  // suggestInternalCategoryMatches (never trusts an AI-invented id); the
  // suggested brand is a plain free-text fill. Falls back to the same
  // local matcher (no AI) if the call fails, so it never blocks.
  const [aiCatBrandLoading, setAiCatBrandLoading] = useState(false);
  const [catBrandSuggestion, setCatBrandSuggestion] = useState(null); // { categoryLabel, categoryMatch, brand } | null
  async function generateAiCategoryBrandSuggestion() {
    if (!listingForm.title.trim()) {
      showToast(t("请先输入商品标题", "Enter a title first"));
      return;
    }
    setAiCatBrandLoading(true);
    const { data, error } = await supabaseClient.functions.invoke("ai-generate", {
      body: { action: "category_brand_suggest", title: listingForm.title },
    });
    setAiCatBrandLoading(false);
    const errMessage = await extractInvokeError(error, data);
    const suggestedCategory = errMessage ? "" : (data?.category || "");
    const suggestedBrand = errMessage ? "" : (data?.brand || "");
    if (errMessage) console.error("generateAiCategoryBrandSuggestion failed, using local match only", errMessage);
    const matchSource = suggestedCategory || listingForm.title;
    const matches = listingForm.platform === "TikTok Shop" && tiktokApiStatus === "ok"
      ? suggestTiktokRealCategoryMatches(matchSource)
      : suggestInternalCategoryMatches(matchSource, listingForm.platform);
    setCatBrandSuggestion({
      categoryLabel: suggestedCategory || null,
      categoryMatch: matches[0] || null,
      brand: suggestedBrand && suggestedBrand !== "No Brand" ? suggestedBrand : "",
    });
  }
  function applySuggestedCategory() {
    if (catBrandSuggestion?.categoryMatch) applyCategorySuggestion(listingForm.platform, catBrandSuggestion.categoryMatch);
  }
  function applySuggestedBrand() {
    if (catBrandSuggestion?.brand) setListingForm((prev) => ({ ...prev, brand: catBrandSuggestion.brand, tiktok_brand_id: "" }));
  }

  // ---- 独立全屏页面 + URL 同步 (2026-08-24, new) — 新增/编辑弹窗改为独立
  // 全屏页面（不再是 Modal）。本项目没有接入 react-router（整站都是
  // tab state 切换，见 erp-mvp-demo.jsx），为避免为此单一功能引入路由库、
  // 影响其他所有 tab/卡片，这里改用原生 history.pushState/popstate 让地
  // 址栏显示真实的 /products/new 或 /products/edit/:id 并支持浏览器返回
  // 按钮，同时仍在本组件内部渲染（不做整站路由重构）。
  useEffect(() => {
    function onPopState() {
      setShowListingForm(false);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  function closeListingForm() {
    setShowListingForm(false);
    if (window.location.pathname.startsWith("/products/")) {
      window.history.pushState(null, "", "/");
    }
  }
  // 重置变体状态 (2026-08-25) — shared by openCreateListing (blank slate)
  // and openEditListing (before loading any existing rows), so a stale
  // previous listing's spec chips/rows never bleed into the next one.
  function resetVariantState() {
    setMultiVariantsOn(false);
    setSpec1Name(""); setSpec1Values(""); setSpec2Name(""); setSpec2Values("");
    setVariationRows([]); setSpec1OptionImages({}); setSpec2OptionImages({});
    setSpec1NewOption(""); setSpec2NewOption("");
    setSelectedVariantIdx(new Set()); setShowBatchVariantEdit(false);
    setBatchVariantPrice(""); setBatchVariantStock("");
  }
  function openCreateListing(platform) {
    setEditingListingId(null);
    setListingForm({ ...emptyListingForm, platform });
    setShopeeL1(""); setShopeeL2(""); setTiktokL1(""); setTiktokL2("");
    setTiktokRealL1(""); setTiktokRealL2(""); setTiktokRealAttrs([]);
    resetVariantState();
    // 平台专属数据源 (2026-08-25) — Shopee's page never calls the TikTok
    // category/brand API at all; only TikTok's page does.
    if (platform === "TikTok Shop") {
      loadTiktokRealCategories();
      loadTiktokRealBrands();
    }
    setVideoError("");
    setShowListingForm(true);
    window.history.pushState(null, "", platform === "TikTok Shop" ? "/products/tiktok/new" : "/products/shopee/new");
  }
  function openEditListing(l) {
    // 平台推断 (2026-08-25) — l.platform is set for every row created after
    // the platform split; a small number of legacy rows saved before that
    // column existed fall back to inferring from which category field is
    // populated (see the migration's backfill for the same logic).
    const platform = l.platform || (l.tiktok_category_leaf_id || l.tiktok_real_category_id ? "TikTok Shop" : "Shopee");
    setEditingListingId(l.id);
    setListingForm({
      platform,
      product_id: l.product_id || "", sku: l.sku || "", title: l.title, description: l.description || "",
      category: l.category || "",
      // Falls back to the legacy single image_url for rows saved before the
      // gallery existed, so editing an older listing doesn't show empty.
      image_urls: Array.isArray(l.image_urls) && l.image_urls.length > 0 ? l.image_urls : (l.image_url ? [l.image_url] : []),
      base_price: String(l.base_price),
      base_stock: l.base_stock != null ? String(l.base_stock) : "",
      brand: l.brand || "No Brand", tiktok_brand_id: l.tiktok_brand_id || "",
      // Display value matches the saved unit preference — weight_kg is
      // always stored canonically in kg (see saveListing), so a 'g'
      // preference needs converting back for display (500g stored as
      // 0.5kg should show "500", not "0.5").
      weight_kg: l.weight_kg != null ? String(l.weight_unit === "g" ? Math.round(l.weight_kg * 1000) : l.weight_kg) : "",
      weight_unit: l.weight_unit || "kg",
      length_cm: l.length_cm != null ? String(l.length_cm) : "",
      width_cm: l.width_cm != null ? String(l.width_cm) : "",
      height_cm: l.height_cm != null ? String(l.height_cm) : "",
      is_dangerous: !!l.is_dangerous, is_cod: !!l.is_cod, video_url: l.video_url || "",
      shopee_shipping_channels: Array.isArray(l.shopee_shipping_channels) ? l.shopee_shipping_channels : [],
      tiktok_shipping_channels: Array.isArray(l.tiktok_shipping_channels) ? l.tiktok_shipping_channels : [],
      shopee_category_leaf_id: l.shopee_category_leaf_id || "",
      tiktok_category_leaf_id: l.tiktok_category_leaf_id || "",
      tiktok_real_category_id: l.tiktok_real_category_id || "",
      attributes: Array.isArray(l.attributes) ? l.attributes : [],
    });
    // Re-derive the cascading dropdowns' level1/level2 from the saved leaf
    // id so editing shows the same path that was picked, not blank selects.
    const shopeeLeaf = categoryTrees.find((c) => c.id === l.shopee_category_leaf_id);
    setShopeeL1(shopeeLeaf?.level1 || ""); setShopeeL2(shopeeLeaf?.level2 || "");
    const tiktokLeaf = categoryTrees.find((c) => c.id === l.tiktok_category_leaf_id);
    setTiktokL1(tiktokLeaf?.level1 || ""); setTiktokL2(tiktokLeaf?.level2 || "");
    setTiktokRealL1(""); setTiktokRealL2(""); setTiktokRealAttrs([]);
    resetVariantState();
    loadExistingVariations(l.id);
    if (platform === "TikTok Shop") {
      loadTiktokRealCategories();
      loadTiktokRealBrands();
    }
    setVideoError("");
    setShowListingForm(true);
    window.history.pushState(null, "", platform === "TikTok Shop" ? `/products/tiktok/edit/${l.id}` : `/products/shopee/edit/${l.id}`);
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
      // Only seed the gallery from the real product's image when it's still
      // empty, so re-picking a SKU never clobbers photos already uploaded.
      image_urls: listingForm.image_urls.length > 0 ? listingForm.image_urls : (p.imageUrl ? [p.imageUrl] : []),
      category: listingForm.category || p.category || "",
      base_price: listingForm.base_price || String(p.price || ""),
      weight_kg: listingForm.weight_kg || (p.weightKg ? String(p.weightKg) : ""),
    });
  }

  // 重量 g/kg 切换 (2026-08-24, new) — converts the currently-typed number
  // so switching units doesn't silently change the real weight (500g ->
  // toggling to kg shows 0.5, not a raw "500").
  function setWeightUnit(unit) {
    setListingForm((prev) => {
      if (unit === prev.weight_unit || !prev.weight_kg) return { ...prev, weight_unit: unit };
      const n = Number(prev.weight_kg);
      const converted = unit === "g" ? n * 1000 : n / 1000;
      return { ...prev, weight_unit: unit, weight_kg: String(+converted.toFixed(3)) };
    });
  }
  function applyWeightPreset(grams) {
    setListingForm((prev) => ({
      ...prev,
      weight_unit: "g",
      weight_kg: String(grams),
    }));
  }
  function toggleShopeeChannel(name) {
    setListingForm((prev) => ({
      ...prev,
      shopee_shipping_channels: prev.shopee_shipping_channels.includes(name)
        ? prev.shopee_shipping_channels.filter((c) => c !== name)
        : [...prev.shopee_shipping_channels, name],
    }));
  }
  function toggleTiktokChannel(name) {
    setListingForm((prev) => ({
      ...prev,
      tiktok_shipping_channels: prev.tiktok_shipping_channels.includes(name)
        ? prev.tiktok_shipping_channels.filter((c) => c !== name)
        : [...prev.tiktok_shipping_channels, name],
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
  // Tracks which attribute rows are in "custom value" mode (2026-08-27,
  // new) — separate from listingForm.attributes because picking "Enter a
  // custom value…" from the dropdown must reveal the text input even
  // before anything has been typed into it (a.value === "" at that point,
  // so it can't be inferred from the value alone).
  const [customAttrIdx, setCustomAttrIdx] = useState(new Set());

  async function saveListing() {
    if (!listingForm.title.trim()) { showToast(t("请填写商品标题", "Please enter a title")); return; }
    if (listingForm.title.trim().length > TITLE_MAX_LEN) { showToast(t(`商品名称不能超过 ${TITLE_MAX_LEN} 字符`, `Title must be ${TITLE_MAX_LEN} characters or fewer`)); return; }
    // TikTok requires real package dimensions for shipping calc — force all
    // three, not just weight (2026-08-24, new).
    if (!listingForm.length_cm || !listingForm.width_cm || !listingForm.height_cm) {
      showToast(t("请填写完整的包裹长/宽/高 (cm)", "Please fill in package length/width/height (cm)"));
      return;
    }
    const isShopee = listingForm.platform === "Shopee";
    const isTiktok = listingForm.platform === "TikTok Shop";
    // 强制选择末级叶子类目 (2026-08-24, new; scoped per-platform 2026-08-25)
    // — category_trees rows are already denormalized leaf-only rows (see
    // file-top note), and the real TikTok category picker's third dropdown
    // is likewise always a leaf, so "picked a category at all" == "picked
    // a leaf" here. Now that a form is exclusively one platform, only that
    // platform's leaf field is required — not "either platform" anymore.
    const hasShopeeLeaf = !!listingForm.shopee_category_leaf_id;
    const hasTiktokLeaf = !!(listingForm.tiktok_category_leaf_id || listingForm.tiktok_real_category_id);
    if ((isShopee && !hasShopeeLeaf) || (isTiktok && !hasTiktokLeaf)) {
      showToast(t("请选择末级叶子类目", "Please select a leaf category"));
      return;
    }
    // shopee_category_path/tiktok_category_path stay as a materialized
    // [level1,level2,level3] display copy derived from the chosen leaf, so
    // the listing table can show the path without a join.
    const shopeeLeaf = categoryTrees.find((c) => c.id === listingForm.shopee_category_leaf_id);
    const tiktokLeaf = categoryTrees.find((c) => c.id === listingForm.tiktok_category_leaf_id);
    // TikTok path prefers the real API selection (tiktok_real_category_id)
    // when present — falls back to the internal-library leaf otherwise
    // (only one of the two is ever populated, whichever selector was
    // actually usable this time — see file-top note on why both exist).
    const tiktokRealNorm = tiktokRealCategories.map(normalizeTikTokCategory);
    const tiktokRealPathNames = listingForm.tiktok_real_category_id
      ? [tiktokRealL1, tiktokRealL2, listingForm.tiktok_real_category_id]
          .map((id) => tiktokRealNorm.find((c) => c.id === id)?.name)
          .filter(Boolean)
      : null;
    const payload = {
      // 平台彻底解耦 (2026-08-25) — this row belongs to exactly one
      // platform; every field below that's specific to the *other*
      // platform is explicitly nulled/emptied rather than left however the
      // form state happened to hold it, so a Shopee listing can never carry
      // stray TikTok category/brand/logistics data and vice versa.
      platform: listingForm.platform,
      product_id: listingForm.product_id || null,
      sku: listingForm.sku.trim() || null,
      title: listingForm.title.trim(),
      description: listingForm.description.trim() || null,
      category: listingForm.category.trim() || null,
      // image_url stays as a read-only "first image" mirror for older
      // consumers (main list thumbnail, watermark tool) that only show one
      // image; image_urls is the real ordered gallery.
      image_url: listingForm.image_urls[0] || null,
      image_urls: listingForm.image_urls,
      base_price: Number(listingForm.base_price) || 0,
      // 基础库存 (2026-08-25, new) — only meaningful in single-SKU mode
      // (多规格开关关闭); left populated either way (harmless) since the
      // per-SKU stock on product_listing_variations is what actually
      // matters once variants are on.
      base_stock: listingForm.base_stock !== "" ? Math.round(Number(listingForm.base_stock)) || 0 : null,
      brand: listingForm.brand.trim() || "No Brand",
      tiktok_brand_id: isTiktok ? (listingForm.tiktok_brand_id || null) : null,
      // Canonical storage is always kg regardless of which unit the g/kg
      // toggle was left on when saving (2026-08-24, new toggle).
      weight_kg: listingForm.weight_kg ? Number(listingForm.weight_kg) * (listingForm.weight_unit === "g" ? 0.001 : 1) : null,
      weight_unit: listingForm.weight_unit,
      length_cm: Number(listingForm.length_cm),
      width_cm: Number(listingForm.width_cm),
      height_cm: Number(listingForm.height_cm),
      is_dangerous: isTiktok ? listingForm.is_dangerous : false,
      is_cod: isTiktok ? listingForm.is_cod : false,
      video_url: listingForm.video_url || null,
      shopee_shipping_channels: isShopee ? listingForm.shopee_shipping_channels : [],
      tiktok_shipping_channels: isTiktok ? listingForm.tiktok_shipping_channels : [],
      shopee_category_leaf_id: isShopee ? (listingForm.shopee_category_leaf_id || null) : null,
      tiktok_category_leaf_id: isTiktok ? (listingForm.tiktok_category_leaf_id || null) : null,
      tiktok_real_category_id: isTiktok ? (listingForm.tiktok_real_category_id || null) : null,
      shopee_category_path: isShopee && shopeeLeaf ? [shopeeLeaf.level1, shopeeLeaf.level2, shopeeLeaf.level3] : null,
      tiktok_category_path: isTiktok ? (tiktokRealPathNames?.length ? tiktokRealPathNames : (tiktokLeaf ? [tiktokLeaf.level1, tiktokLeaf.level2, tiktokLeaf.level3] : null)) : null,
      attributes: listingForm.attributes.filter((a) => a.name.trim()),
      updated_at: new Date().toISOString(),
    };
    // 变体随主表单一起保存 (2026-08-25) — a brand-new listing has no id
    // until this insert returns one, so persistVariations always runs
    // *after* this write, using whichever id is now known (editingListingId
    // for an update, or the freshly-inserted row's id for a create).
    let listingId = editingListingId;
    if (editingListingId) {
      const { error } = await supabaseClient.from("product_listings").update(payload).eq("id", editingListingId);
      if (error) { showToast(t("保存失败", "Save failed")); console.error("saveListing failed", error); return; }
    } else {
      const { data, error } = await supabaseClient.from("product_listings").insert(payload).select("id").single();
      if (error) { showToast(t("保存失败", "Save failed")); console.error("saveListing failed", error); return; }
      listingId = data.id;
    }
    const variantsOk = await persistVariations(listingId);
    if (!variantsOk) return;
    closeListingForm();
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

  // ---- 多层级规格与 SKU 变体管理 (2026-08-25: moved inline into the
  // create/edit page itself — see "5. 销售信息与变体" in the full-page
  // renderer below — instead of a separate post-save modal. All of this
  // state now shares listingForm's lifecycle: reset in openCreateListing,
  // loaded from product_listing_variations in openEditListing, and
  // persisted by saveListing() right after the product_listings row
  // itself is written (see persistVariations). ----
  const [spec1Name, setSpec1Name] = useState("");
  const [spec1Values, setSpec1Values] = useState("");
  const [spec2Name, setSpec2Name] = useState("");
  const [spec2Values, setSpec2Values] = useState("");
  const [variationRows, setVariationRows] = useState([]); // [{spec1_value, spec2_value, sku, price, stock, image_url}]
  // 批量修改价格/库存 (2026-08-24, new) — row selection + a small inline
  // batch-edit bar; applies to the checked rows, or all rows when none
  // are checked (so a quick "set every price to X" doesn't need selecting
  // everything first).
  const [selectedVariantIdx, setSelectedVariantIdx] = useState(new Set());
  const [showBatchVariantEdit, setShowBatchVariantEdit] = useState(false);
  const [batchVariantPrice, setBatchVariantPrice] = useState("");
  const [batchVariantStock, setBatchVariantStock] = useState("");
  // 多规格开关 + 规格选项图片 (2026-08-25, new) — TikTok Seller Center
  // style: a toggle for whether this listing even has variants at all
  // (off = single price/stock, set on the main listing page), plus a
  // per-option photo (keyed by the option's text value) so each spec chip
  // — e.g. "BLACK SPRING" — can carry its own picture independent of the
  // generated SKU rows below (a photo added before "生成组合" is run still
  // gets picked up once the row exists).
  const [multiVariantsOn, setMultiVariantsOn] = useState(false);
  const [spec1OptionImages, setSpec1OptionImages] = useState({});
  const [spec2OptionImages, setSpec2OptionImages] = useState({});
  const [specImageUploading, setSpecImageUploading] = useState(null); // "1:BLACK SPRING" while in flight
  const [spec1NewOption, setSpec1NewOption] = useState("");
  const [spec2NewOption, setSpec2NewOption] = useState("");

  // 加载已有变体 (2026-08-25) — called from openEditListing so editing an
  // existing listing shows its saved variants inline immediately; there's
  // no separate "open variations" entry point anymore (see note above).
  async function loadExistingVariations(listingId) {
    setSelectedVariantIdx(new Set());
    setShowBatchVariantEdit(false);
    setBatchVariantPrice(""); setBatchVariantStock("");
    const { data, error } = await supabaseClient.from("product_listing_variations").select("*").eq("listing_id", listingId).order("created_at");
    if (error) { console.error("loadVariations failed", error); setVariationRows([]); return; }
    // weight_kg column always holds the real kg value (converted on save,
    // same convention as the top-level weight field) — weight_unit is only
    // the display preference, so convert back to grams here for display
    // when that's what was last used, mirroring line ~409's top-level mapping.
    setVariationRows((data || []).map((r) => ({
      ...r,
      weight_kg: r.weight_kg != null ? String(r.weight_unit === "g" ? Math.round(r.weight_kg * 1000) : r.weight_kg) : "",
      weight_unit: r.weight_unit || "kg",
    })));
    setSpec1Name(data?.[0]?.spec1_name || "");
    setSpec2Name(data?.[0]?.spec2_name || "");
    setSpec1Values([...new Set((data || []).map((r) => r.spec1_value).filter(Boolean))].join(","));
    setSpec2Values([...new Set((data || []).map((r) => r.spec2_value).filter(Boolean))].join(","));
    // 多规格开关 — on if this listing already has any variant rows saved.
    setMultiVariantsOn((data || []).length > 0);
    // Seed each option's image from whichever existing row first carried
    // that spec1/spec2 value's photo, so reopening shows the chips'
    // pictures instead of blank placeholders.
    const img1 = {}; const img2 = {};
    for (const r of data || []) {
      if (r.spec1_value && r.image_url && !img1[r.spec1_value]) img1[r.spec1_value] = r.image_url;
      if (r.spec2_value && r.image_url && !img2[r.spec2_value]) img2[r.spec2_value] = r.image_url;
    }
    setSpec1OptionImages(img1);
    setSpec2OptionImages(img2);
    setSpec1NewOption(""); setSpec2NewOption("");
  }

  // 生成组合 — cartesian product of spec1 × spec2 values (spec2 optional,
  // for a single-level spec). Preserves an existing row's sku/price/stock/
  // image if that exact combination was already there, so regenerating
  // after adding one more value doesn't wipe out data already entered.
  // Takes the value lists as arguments (rather than reading spec1Values/
  // spec2Values state directly) so callers that just changed those values
  // this same tick — e.g. addSpecValue below — can pass the fresh list
  // immediately instead of racing a stale closure against the pending
  // setState (a setTimeout(generateCombos, 0) here would silently drop
  // whichever option was just added, since the deferred call would still
  // close over the pre-update state).
  function regenerateRows(v1, v2) {
    const existing = new Map(variationRows.map((r) => [`${r.spec1_value || ""}|${r.spec2_value || ""}`, r]));
    const combos = [];
    const pairs = v2.length > 0 ? v1.flatMap((a) => v2.map((b) => [a, b])) : v1.map((a) => [a, ""]);
    for (const [a, b] of pairs) {
      const key = `${a}|${b}`;
      // A newly-created row inherits whichever option photo was already
      // uploaded for its spec1 (or spec2, if spec1 has none) value.
      combos.push(existing.get(key) || { spec1_value: a, spec2_value: b, sku: "", price: listingFormBasePriceFallback(), stock: 0, discount_percent: 0, image_url: spec1OptionImages[a] || spec2OptionImages[b] || "", weight_kg: "", weight_unit: "kg" });
    }
    setVariationRows(combos);
  }
  function generateCombos() {
    regenerateRows(specValuesList(1), specValuesList(2));
  }
  // Small helper so a freshly-generated combo starts from the parent
  // listing's real base price instead of RM0, saving retyping.
  function listingFormBasePriceFallback() {
    return Number(listingForm.base_price) || 0;
  }

  // ---- 规格选项 chip 管理 (2026-08-25, new) — TikTok Seller Center style
  // option chips (add/remove/reorder/photo) instead of a raw comma-
  // separated text field. All of these operate on the same spec1Values/
  // spec2Values comma-string state that generateCombos already reads, so
  // existing save/load logic is untouched — this is purely a nicer editor
  // on top of it. Every mutation re-runs generateCombos immediately so the
  // SKU card list below stays in sync without a separate "Generate" click.
  function specValuesList(specNum) {
    return (specNum === 1 ? spec1Values : spec2Values).split(",").map((s) => s.trim()).filter(Boolean);
  }
  function addSpecValue(specNum, raw) {
    const value = raw.trim();
    if (!value) return;
    const list = specValuesList(specNum);
    if (list.includes(value)) return;
    const nextList = [...list, value];
    if (specNum === 1) {
      setSpec1Values(nextList.join(","));
      regenerateRows(nextList, specValuesList(2));
    } else {
      setSpec2Values(nextList.join(","));
      regenerateRows(specValuesList(1), nextList);
    }
  }
  function removeSpecValue(specNum, value) {
    const list = specValuesList(specNum).filter((v) => v !== value);
    const next = list.join(",");
    if (specNum === 1) {
      setSpec1Values(next);
      setSpec1OptionImages((prev) => { const { [value]: _, ...rest } = prev; return rest; });
    } else {
      setSpec2Values(next);
      setSpec2OptionImages((prev) => { const { [value]: _, ...rest } = prev; return rest; });
    }
    // Also drop any generated rows that used this exact option value, since
    // it no longer exists to regenerate from.
    setVariationRows((prev) => prev.filter((r) => (specNum === 1 ? r.spec1_value : r.spec2_value) !== value));
  }
  function moveSpecValue(specNum, value, dir) {
    const list = specValuesList(specNum);
    const idx = list.indexOf(value);
    const swapWith = idx + dir;
    if (idx < 0 || swapWith < 0 || swapWith >= list.length) return;
    [list[idx], list[swapWith]] = [list[swapWith], list[idx]];
    const next = list.join(",");
    if (specNum === 1) setSpec1Values(next); else setSpec2Values(next);
  }
  // 多规格开关 (2026-08-25, new) — turning it off clears all variant state
  // (nothing is written to the DB until 保存变体, so this is safe to do
  // freely); the listing then goes back to using its own base_price/stock
  // as a single SKU, matching what "关闭多规格" means on TikTok's own
  // Seller Center.
  function toggleMultiVariants() {
    setMultiVariantsOn((prev) => {
      const next = !prev;
      if (!next) {
        setVariationRows([]); setSpec1Name(""); setSpec1Values(""); setSpec2Name(""); setSpec2Values("");
        setSpec1OptionImages({}); setSpec2OptionImages({}); setSelectedVariantIdx(new Set());
      }
      return next;
    });
  }
  async function uploadSpecOptionImage(specNum, value, file) {
    if (!file || !file.type.startsWith("image/")) return;
    const key = `${specNum}:${value}`;
    setSpecImageUploading(key);
    const path = `variant-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error } = await supabaseClient.storage.from("product-images").upload(path, file, { upsert: false });
    setSpecImageUploading(null);
    if (error) { showToast(t("上传失败", "Upload failed")); console.error("uploadSpecOptionImage failed", error); return; }
    const { data: pub } = supabaseClient.storage.from("product-images").getPublicUrl(path);
    if (specNum === 1) setSpec1OptionImages((prev) => ({ ...prev, [value]: pub.publicUrl }));
    else setSpec2OptionImages((prev) => ({ ...prev, [value]: pub.publicUrl }));
    // Patch any already-generated rows carrying this option value so the
    // new photo shows immediately, not just on the next regenerate.
    setVariationRows((prev) => prev.map((r) => ((specNum === 1 ? r.spec1_value : r.spec2_value) === value ? { ...r, image_url: pub.publicUrl } : r)));
  }
  function updateVariationField(idx, field, value) {
    setVariationRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }
  // 单条变体重量单位切换 (2026-08-26, new) — same conversion-on-toggle
  // logic as the top-level setWeightUnit() above (kg<->g), scoped to one
  // row so switching units doesn't silently change the real weight typed.
  function setVariantWeightUnit(idx, unit) {
    setVariationRows((prev) => prev.map((r, i) => {
      if (i !== idx || unit === r.weight_unit || !r.weight_kg) return i === idx ? { ...r, weight_unit: unit } : r;
      const n = Number(r.weight_kg);
      const converted = unit === "g" ? n * 1000 : n / 1000;
      return { ...r, weight_unit: unit, weight_kg: String(+converted.toFixed(3)) };
    }));
  }
  function removeVariationRow(idx) {
    setVariationRows((prev) => prev.filter((_, i) => i !== idx));
    setSelectedVariantIdx((prev) => {
      const next = new Set();
      prev.forEach((i) => { if (i < idx) next.add(i); else if (i > idx) next.add(i - 1); });
      return next;
    });
  }
  // 添加规格 (2026-08-24, new) — a single manually-typed row, for when
  // staff just needs one more variant instead of a full cartesian
  // regenerate via spec1/spec2 values.
  function addVariantRow() {
    setVariationRows((prev) => [...prev, { spec1_value: "", spec2_value: "", sku: "", price: listingFormBasePriceFallback(), stock: 0, discount_percent: 0, image_url: "", weight_kg: "", weight_unit: "kg" }]);
  }
  function toggleVariantSelect(idx) {
    setSelectedVariantIdx((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }
  function toggleSelectAllVariants() {
    setSelectedVariantIdx((prev) => (prev.size === variationRows.length ? new Set() : new Set(variationRows.map((_, i) => i))));
  }
  // 批量修改 (2026-08-24, new) — sets price and/or stock on the checked
  // rows (or every row, if none are checked); blank field = leave that
  // field untouched on those rows.
  function applyBatchVariantEdit() {
    const targets = selectedVariantIdx.size > 0 ? selectedVariantIdx : new Set(variationRows.map((_, i) => i));
    setVariationRows((prev) => prev.map((r, i) => (targets.has(i) ? {
      ...r,
      price: batchVariantPrice !== "" ? Number(batchVariantPrice) : r.price,
      stock: batchVariantStock !== "" ? Number(batchVariantStock) : r.stock,
    } : r)));
    setBatchVariantPrice(""); setBatchVariantStock(""); setShowBatchVariantEdit(false);
  }

  // 保存变体 (2026-08-25) — called from saveListing() right after the
  // product_listings row itself is written, once a real listingId exists
  // (a brand-new listing has no id to attach variants to until that
  // insert returns). Always clears any previously-saved rows first, then
  // re-inserts only if 多规格 is on and at least one row exists — so
  // switching the toggle off and saving correctly wipes old variants too.
  // Returns false (and shows a toast) on failure so saveListing can abort
  // before closing the page.
  async function persistVariations(listingId) {
    const { error: delErr } = await supabaseClient.from("product_listing_variations").delete().eq("listing_id", listingId);
    if (delErr) { showToast(t("变体保存失败", "Failed to save variations")); console.error("persistVariations delete failed", delErr); return false; }
    if (multiVariantsOn && variationRows.length > 0) {
      const rows = variationRows.map((r) => ({
        listing_id: listingId,
        spec1_name: spec1Name.trim() || null, spec1_value: r.spec1_value || null,
        spec2_name: spec2Name.trim() || null, spec2_value: r.spec2_value || null,
        sku: r.sku?.trim() || null, price: Number(r.price) || 0, stock: Math.round(Number(r.stock)) || 0,
        discount_percent: Math.min(100, Math.max(0, Number(r.discount_percent) || 0)),
        image_url: r.image_url?.trim() || null,
        // Automatic unit conversion on save (2026-08-26, new) — same
        // convention as the top-level weight field (see line ~567): the
        // DB column always stores real kg regardless of which unit the
        // row was displayed/typed in; weight_unit is saved alongside
        // purely so re-opening this listing shows the same unit again.
        weight_kg: r.weight_kg !== "" && r.weight_kg != null ? Number(r.weight_kg) * (r.weight_unit === "g" ? 0.001 : 1) : null,
        weight_unit: r.weight_unit === "g" ? "g" : "kg",
      }));
      const { error } = await supabaseClient.from("product_listing_variations").insert(rows);
      if (error) { showToast(t("变体保存失败", "Failed to save variations")); console.error("persistVariations insert failed", error); return false; }
    }
    return true;
  }

  // ---- 类目库管理 (2026-08-24, new) — lets staff grow/edit the internal
  // category_trees + category_attribute_templates dataset from the UI,
  // since there's no live official API to sync from (see file-top note).
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [newCategory, setNewCategory] = useState({ platform: "Shopee", level1: "", level2: "", level3: "", commission_rate: "" });
  const [expandedLeafId, setExpandedLeafId] = useState(null);
  const [newAttrName, setNewAttrName] = useState("");
  const [newAttrRequired, setNewAttrRequired] = useState(true);

  async function addCategoryLeaf() {
    const { platform, level1, level2, level3, commission_rate } = newCategory;
    if (!level1.trim() || !level2.trim() || !level3.trim()) { showToast(t("请填写完整三级分类", "Please fill in all 3 levels")); return; }
    const { error } = await supabaseClient.from("category_trees").insert({
      platform, level1: level1.trim(), level2: level2.trim(), level3: level3.trim(),
      commission_rate: commission_rate !== "" ? Number(commission_rate) : null,
    });
    if (error) {
      showToast(error.code === "23505" ? t("该分类已存在", "This category already exists") : t("添加失败", "Add failed"));
      console.error("addCategoryLeaf failed", error);
      return;
    }
    setNewCategory({ platform, level1: "", level2: "", level3: "", commission_rate: "" });
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

  // ---- 新增/编辑商品：独立全屏页面 (2026-08-24, new) — replaces the old
  // centered Modal entirely. Real URL via history.pushState (see the note
  // above openCreateListing). Field order per explicit request: 商品图片 →
  // SKU → 商品标题 → 分类/品牌 → 详情描述 → 商品视频 → 销售信息与变体 →
  // 包裹与物流信息 (weight/dimensions/COD/hazardous/shipping channels/
  // category cascading selectors/attributes).
  if (showListingForm) {
    return (
      <div className="min-h-screen bg-slate-50 -m-4 sm:-m-6">
        {/* 顶部导航栏 — 返回按钮 + 固定保存/发布操作栏 */}
        <div className="sticky top-0 z-40 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center justify-between">
          <button onClick={closeListingForm} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft size={16} /> {t("返回商品发布中心", "Back to Listing Center")}
          </button>
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium text-slate-700 hidden sm:block">
              {editingListingId ? t(`编辑 ${listingForm.platform} 商品`, `Edit ${listingForm.platform} Listing`) : t(`新增 ${listingForm.platform} 商品`, `New ${listingForm.platform} Listing`)}
            </div>
            <button onClick={closeListingForm} className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">{t("取消", "Cancel")}</button>
            <button onClick={saveListing} className="text-sm px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800">{t("保存", "Save")}</button>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
          {/* 1. 商品图片 — 置顶 (2026-08-26, upgraded to match TikTok Shop's
              own uploader layout: one horizontal scrollable row, "+" slot
              always immediately after the last image, up to MAX_PRODUCT_IMAGES
              total, delete button hidden until hover.) */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs text-slate-400 mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1"><ImageIcon size={12} /> {t("商品图片", "Product Images")}</span>
              <span className="text-slate-300">{listingForm.image_urls.length}/{MAX_PRODUCT_IMAGES}</span>
            </div>
            <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
              {listingForm.image_urls.map((url, idx) => (
                <div
                  key={url}
                  draggable
                  onDragStart={() => setDraggedImageIdx(idx)}
                  onDragOver={(e) => { e.preventDefault(); if (idx !== dragOverImageIdx) setDragOverImageIdx(idx); }}
                  onDragLeave={() => setDragOverImageIdx((cur) => (cur === idx ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggedImageIdx !== null) reorderImages(draggedImageIdx, idx);
                    setDraggedImageIdx(null);
                    setDragOverImageIdx(null);
                  }}
                  onDragEnd={() => { setDraggedImageIdx(null); setDragOverImageIdx(null); }}
                  className={`group relative h-20 w-20 shrink-0 rounded-lg border overflow-hidden bg-slate-50 cursor-grab active:cursor-grabbing transition-shadow ${
                    dragOverImageIdx === idx && draggedImageIdx !== idx ? "border-purple-400 ring-2 ring-purple-300" : "border-slate-200"
                  } ${draggedImageIdx === idx ? "opacity-40" : ""}`}
                >
                  <img src={url} alt="" className="w-full h-full object-cover pointer-events-none" />
                  {/* 主图 / Main Cover badge (2026-08-26) — always the
                      first array element, matches what saveListing() sends
                      as the payload's main image_url. */}
                  {idx === 0 && (
                    <div className="absolute top-0.5 left-0.5 px-1.5 py-0.5 rounded bg-purple-600 text-white text-[9px] font-medium leading-tight shadow-sm">
                      {t("主图", "Main Cover")}
                    </div>
                  )}
                  {/* Delete button — hidden until hover (2026-08-26, was
                      always-visible), matching TikTok's own uploader. */}
                  <button
                    type="button"
                    onClick={() => removeImageAt(idx)}
                    aria-label={t("删除图片", "Delete image")}
                    className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-600"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {listingForm.image_urls.length < MAX_PRODUCT_IMAGES && (
                <label className={`h-20 w-20 shrink-0 rounded-lg border border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer ${imageUploading ? "border-slate-100 text-slate-300" : "border-slate-300 text-slate-400 hover:bg-slate-50"}`}>
                  <Plus size={16} />
                  <span className="text-[10px] text-center px-1">{imageUploading ? t("上传中…", "Uploading…") : t("添加图片", "Add Image")}</span>
                  <input type="file" accept="image/*" multiple disabled={imageUploading} onChange={(e) => { handleImageFiles(e.target.files); e.target.value = ""; }} className="hidden" />
                </label>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <label className={`text-xs px-3 py-2 rounded-lg border cursor-pointer flex items-center gap-1 ${imageUploading ? "border-slate-100 text-slate-300" : "border-slate-200 hover:bg-slate-50 text-slate-600"}`}>
                <Camera size={12} /> {t("拍照", "Take Photo")}
                <input type="file" accept="image/*" capture="environment" disabled={imageUploading || listingForm.image_urls.length >= MAX_PRODUCT_IMAGES} onChange={(e) => { handleImageFiles(e.target.files); e.target.value = ""; }} className="hidden" />
              </label>
              <label className={`text-xs px-3 py-2 rounded-lg border cursor-pointer flex items-center gap-1 ${imageUploading ? "border-slate-100 text-slate-300" : "border-slate-200 hover:bg-slate-50 text-slate-600"}`}>
                <Upload size={12} /> {t("上传照片", "Upload Photo")}
                <input type="file" accept="image/*" multiple disabled={imageUploading || listingForm.image_urls.length >= MAX_PRODUCT_IMAGES} onChange={(e) => { handleImageFiles(e.target.files); e.target.value = ""; }} className="hidden" />
              </label>
            </div>
            {imageError && <div className="text-[11px] text-rose-600 mt-1">{imageError}</div>}
          </div>

          {/* 2. 关联真实商品 SKU / 商品标题 / 分类 / 品牌 */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div>
              <div className="text-xs text-slate-400 mb-1">{t("关联真实商品 SKU（可选，自动带入）", "Link a real product SKU (optional, auto-fills)")}</div>
              <select value={listingForm.sku} onChange={(e) => pickRealProduct(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg">
                <option value="">{t("不关联", "Not linked")}</option>
                {(inventory || []).map((p) => <option key={p.sku} value={p.sku}>{p.sku} — {p.name}</option>)}
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="text-xs text-slate-400">{t("商品标题", "Title")}</div>
                  <button type="button" onClick={generateAiTitleSuggestions} disabled={aiTitleSuggestLoading} className="text-[11px] text-indigo-600 hover:text-indigo-800 disabled:text-slate-300">+ {aiTitleSuggestLoading ? t("生成中…", "Generating…") : t("推荐", "suggestions")}</button>
                </div>
                <div className={`text-[11px] ${listingForm.title.length > TITLE_MAX_LEN ? "text-rose-500" : "text-slate-300"}`}>{listingForm.title.length}/{TITLE_MAX_LEN}</div>
              </div>
              <div className="flex gap-1.5 relative" ref={aiKeywordWrapRef}>
                <input value={listingForm.title} onChange={(e) => setListingForm({ ...listingForm, title: e.target.value })} maxLength={TITLE_MAX_LEN} className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                {/* Title "+suggestions" dropdown (2026-08-27, new) — 3 full
                    alternative titles from Gemini/Anthropic via
                    generateAiTitleSuggestions(); click replaces the title
                    entirely (distinct from the keyword-append dropdown
                    below, which builds up the title piece by piece). */}
                {showTitleSuggestDropdown && titleSuggestions.length > 0 && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg card-3d p-2 space-y-1">
                    <div className="flex items-center justify-between px-1">
                      <div className="text-[10px] text-slate-400">{t("AI 推荐标题（点击替换）", "AI-suggested titles (click to replace)")}</div>
                      <button type="button" onClick={() => setShowTitleSuggestDropdown(false)} className="text-slate-300 hover:text-slate-600"><X size={12} /></button>
                    </div>
                    {titleSuggestions.map((s, i) => (
                      <button key={i} type="button" onClick={() => applyTitleSuggestion(s)} className="w-full text-left text-xs px-2 py-1.5 rounded-lg hover:bg-indigo-50 text-slate-600">
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                {/* AI 标题生成 (2026-08-26, refined) — real Anthropic call
                    via ai-generate's "keywords" action; see
                    generateAiTitleKeywords() above for the honest
                    "AI-suggested, not live platform data" framing and the
                    missing-API-key error handling. */}
                <button
                  type="button"
                  onClick={generateAiTitleKeywords}
                  disabled={aiTitleLoading}
                  className={`shrink-0 text-xs px-3 py-2 rounded-lg border flex items-center gap-1 whitespace-nowrap ${aiTitleLoading ? "border-slate-100 text-slate-300" : "border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100"}`}
                >
                  <Sparkles size={12} className={aiTitleLoading ? "animate-spin" : ""} />
                  {aiTitleLoading ? t("生成中…", "Generating…") : t("AI 标题生成", "AI Title")}
                </button>
                {/* AI 关键词推荐下拉框 (2026-08-26, new) — two labeled
                    groups, each badge click-to-append (multi-select, per
                    explicit request); "AI 推荐，非实时平台数据" is
                    deliberately part of both section headers so staff
                    never mistake this for real TikTok/Shopee search-volume
                    or competitor analytics — see ai-generate's own comment
                    for why no such live data source exists in this project. */}
                {showAiKeywordDropdown && aiKeywordSuggestions && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg card-3d p-3 space-y-3 max-h-96 overflow-y-auto">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-medium text-slate-500">{t("AI 关键词建议", "AI Keyword Suggestions")}</div>
                      <button type="button" onClick={() => setShowAiKeywordDropdown(false)} className="text-slate-300 hover:text-slate-600"><X size={13} /></button>
                    </div>
                    {aiKeywordSuggestions.trending.length > 0 && (
                      <div>
                        <div className="text-[10px] text-slate-400 mb-1">🔥 {t("买家高频热搜词（AI 推荐，非实时平台数据）", "Buyer High-Volume Search Keywords (AI-suggested, not live platform data)")}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {aiKeywordSuggestions.trending.map((kw, i) => (
                            <button key={i} type="button" onClick={() => appendTitleKeyword(kw, aiKeywordSuggestions.seed)} className="text-[11px] px-2 py-1 rounded-full border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100">
                              {kw}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {aiKeywordSuggestions.competitor.length > 0 && (
                      <div>
                        <div className="text-[10px] text-slate-400 mb-1">🏆 {t("高销量同行标题词组（AI 推荐，非实时平台数据）", "Top Seller Title Keyword Combinations (AI-suggested, not live platform data)")}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {aiKeywordSuggestions.competitor.map((kw, i) => (
                            <button key={i} type="button" onClick={() => appendTitleKeyword(kw, aiKeywordSuggestions.seed)} className="text-[11px] px-2 py-1 rounded-full border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100">
                              {kw}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* Recommended search keywords (2026-08-27, new) — a plain
                  derived hint, not a real buyer-search-volume feed (see
                  the AI keyword dropdown above for why no such live data
                  source exists in this project): just the words making up
                  whichever category is currently selected, offered as
                  quick title add-ons. */}
              {(() => {
                const label = currentCategoryLabel();
                if (!label) return null;
                const lastSegment = label.split(">").pop().trim();
                const words = [...new Set(titleTokens(lastSegment))].slice(0, 5);
                if (words.length === 0) return null;
                return (
                  <div className="mt-1 text-[11px] text-slate-400">
                    {t("推荐搜索关键词（基于分类）：", "Recommended search keywords based on category: ")}
                    {words.map((w, i) => (
                      <span key={w}>
                        {i > 0 && ", "}
                        <button type="button" onClick={() => appendTitleKeyword(w, "")} className="text-indigo-600 hover:underline">{w}</button>
                      </span>
                    ))}
                  </div>
                );
              })()}
              {/* 智能匹配分类 (2026-08-26, new) — real keyword-overlap
                  suggestions from whichever category source is loaded; see
                  suggestTiktokRealCategoryMatches/suggestInternalCategoryMatches
                  above for why this is "smart match", not "AI". Only shown
                  once the title has enough text to actually score against. */}
              {listingForm.title.trim().length >= 2 && (() => {
                const matches = listingForm.platform === "TikTok Shop" && tiktokApiStatus === "ok"
                  ? suggestTiktokRealCategoryMatches(listingForm.title)
                  : suggestInternalCategoryMatches(listingForm.title, listingForm.platform);
                if (matches.length === 0) return null;
                return (
                  <div className="mt-1.5">
                    <div className="text-[10px] text-slate-400 mb-1 flex items-center gap-1">
                      <Sparkles size={10} /> {t("智能匹配分类（点击应用）", "Smart-matched categories (click to apply)")}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {matches.map((m, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => applyCategorySuggestion(listingForm.platform, m)}
                          className="text-[11px] px-2 py-1 rounded-full border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="text-xs text-slate-400">Category</div>
                  <button type="button" onClick={generateAiCategoryBrandSuggestion} disabled={aiCatBrandLoading} className="text-[11px] text-indigo-600 hover:text-indigo-800 disabled:text-slate-300">+ {aiCatBrandLoading ? t("生成中…", "Generating…") : t("推荐", "suggestions")}</button>
                </div>
                {/* 类目树 — 平台隔离 (2026-08-25) — Shopee's page only ever
                    queries the internal Shopee category library; TikTok's page
                    only ever queries the real TikTok Category API (with the
                    internal-library/reauth fallback). Never both at once.
                    Relocated 2026-08-26 to sit beside Brand in one row
                    (explicit layout request); logic/handlers unchanged. */}
                {listingForm.platform === "Shopee" && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs font-medium text-slate-500">{t("🗂 Shopee 三级分类（内部类目库）", "🗂 Shopee Category (internal library)")}</div>
                      <button onClick={() => setShowCategoryManager(true)} className="text-[11px] text-indigo-600 hover:text-indigo-800">{t("管理类目库", "Manage")}</button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <select value={shopeeL1} onChange={(e) => { setShopeeL1(e.target.value); setShopeeL2(""); selectLeaf("shopee_category_leaf_id", ""); }} className="w-full px-2 py-2 text-xs border border-slate-200 rounded-lg bg-white">
                        <option value="">Level 1 / 第1级 / Tahap 1</option>
                        {categoryOptions("Shopee", "level1").map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                      <select value={shopeeL2} onChange={(e) => { setShopeeL2(e.target.value); selectLeaf("shopee_category_leaf_id", ""); }} disabled={!shopeeL1} className="w-full px-2 py-2 text-xs border border-slate-200 rounded-lg bg-white disabled:bg-slate-50">
                        <option value="">Level 2 / 第2级 / Tahap 2</option>
                        {categoryOptions("Shopee", "level2", shopeeL1).map((v) => <option key={v} value={v}>{v}</option>)}
                      </select>
                      <select value={listingForm.shopee_category_leaf_id} onChange={(e) => selectLeaf("shopee_category_leaf_id", e.target.value)} disabled={!shopeeL2} className="w-full px-2 py-2 text-xs border border-slate-200 rounded-lg bg-white disabled:bg-slate-50">
                        <option value="">Level 3 / 第3级 / Tahap 3</option>
                        {categoryOptions("Shopee", "level3", shopeeL1, shopeeL2).map((c) => <option key={c.id} value={c.id}>{c.level3}</option>)}
                      </select>
                    </div>
                    {(() => {
                      const leaf = categoryTrees.find((c) => c.id === listingForm.shopee_category_leaf_id);
                      return leaf?.commission_rate != null ? (
                        <div className="text-[11px] text-amber-600 mt-1">{t(`预计佣金 ${leaf.commission_rate}%`, `Est. commission ${leaf.commission_rate}%`)}</div>
                      ) : null;
                    })()}
                  </div>
                )}
                {listingForm.platform === "TikTok Shop" && (
                  <div>
                    {tiktokApiStatus === "loading" && <div className="text-[11px] text-slate-400 mb-1">{t("加载官方类目中…", "Loading official categories…")}</div>}

                    {tiktokApiStatus === "error" && tiktokApiError?.needsReauth && (
                      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                        {t(
                          "检测到商品权限，如提示 Access Denied 请在【店铺管理】中点击「重新授权」以更新权限。（对应「产品搬仓/搬店」页面店铺管理区域的「使用 TikTok Shop 登录连接」按钮——对已连接店铺重新走一次该流程即可刷新权限。）在权限刷新前，暂时使用下方内部类目库。",
                          "Product permission detected, but if you see Access Denied, go to Store Management and click \"Re-authorize\" to refresh it. (That's the \"Connect with TikTok Shop Login\" button under Product Move / Store Management — running it again for an already-connected store refreshes its permissions.) Using the internal category library below until then.",
                        )}
                      </div>
                    )}
                    {tiktokApiStatus === "error" && !tiktokApiError?.needsReauth && (
                      <div className="text-[11px] text-slate-400 mb-2">{tiktokApiError?.message}</div>
                    )}

                    {tiktokApiStatus === "ok" ? (
                      <div className="relative" ref={categoryPickerRef}>
                        <button
                          type="button"
                          onClick={() => setShowCategoryPicker((v) => !v)}
                          className="w-full flex items-center justify-between px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white hover:border-slate-300 text-left"
                        >
                          <span className={listingForm.tiktok_real_category_id ? "text-slate-700" : "text-slate-400"}>
                            {tiktokRealSelectedPathLabel() || "Select category"}
                          </span>
                          <ChevronDown size={13} className={`text-slate-400 shrink-0 ml-2 transition-transform ${showCategoryPicker ? "rotate-180" : ""}`} />
                        </button>
                        {showCategoryPicker && (
                          <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg card-3d overflow-hidden">
                            <div className="p-2 border-b border-slate-100">
                              <input
                                autoFocus
                                value={categorySearchQuery}
                                onChange={(e) => setCategorySearchQuery(e.target.value)}
                                placeholder="Search category"
                                className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-slate-400"
                              />
                            </div>
                            {categorySearchQuery.trim() ? (
                              <div className="max-h-72 overflow-y-auto">
                                {searchTiktokRealLeaves(categorySearchQuery).map((r) => (
                                  <button
                                    key={r.leafId}
                                    type="button"
                                    onClick={() => pickCategoryFromCascade(r.l1id, r.l2id, r.leafId)}
                                    className="w-full text-left px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 border-b border-slate-50 last:border-b-0"
                                  >
                                    {r.label}
                                  </button>
                                ))}
                                {searchTiktokRealLeaves(categorySearchQuery).length === 0 && (
                                  <div className="px-3 py-3 text-xs text-slate-400 text-center">{t("没有匹配的类目", "No matching categories")}</div>
                                )}
                              </div>
                            ) : (
                              <div className="grid grid-cols-3 h-72">
                                <div className="overflow-y-auto border-r border-slate-100">
                                  {tiktokRealOptions(1).map((c) => (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => { setTiktokRealL1(c.id); setTiktokRealL2(""); selectTiktokRealLeaf(""); }}
                                      className={`w-full text-left px-2.5 py-2 text-xs border-b border-slate-50 ${tiktokRealL1 === c.id ? "bg-indigo-50 text-indigo-600 font-medium" : "text-slate-600 hover:bg-slate-50"}`}
                                    >
                                      {c.name}
                                    </button>
                                  ))}
                                </div>
                                <div className="overflow-y-auto border-r border-slate-100">
                                  {tiktokRealOptions(2, tiktokRealL1).map((c) => (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => { setTiktokRealL2(c.id); selectTiktokRealLeaf(""); }}
                                      className={`w-full text-left px-2.5 py-2 text-xs border-b border-slate-50 ${tiktokRealL2 === c.id ? "bg-indigo-50 text-indigo-600 font-medium" : "text-slate-600 hover:bg-slate-50"}`}
                                    >
                                      {c.name}
                                    </button>
                                  ))}
                                  {tiktokRealL1 && tiktokRealOptions(2, tiktokRealL1).length === 0 && (
                                    <div className="px-2.5 py-2 text-[11px] text-slate-300">{t("无子类目", "No sub-categories")}</div>
                                  )}
                                </div>
                                <div className="overflow-y-auto">
                                  {tiktokRealOptions(3, tiktokRealL1, tiktokRealL2).map((c) => (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => pickCategoryFromCascade(tiktokRealL1, tiktokRealL2, c.id)}
                                      className={`w-full text-left px-2.5 py-2 text-xs border-b border-slate-50 ${listingForm.tiktok_real_category_id === c.id ? "bg-indigo-50 text-indigo-600 font-medium" : "text-slate-600 hover:bg-slate-50"}`}
                                    >
                                      {c.name}
                                    </button>
                                  ))}
                                  {tiktokRealL2 && tiktokRealOptions(3, tiktokRealL1, tiktokRealL2).length === 0 && (
                                    <div className="px-2.5 py-2 text-[11px] text-slate-300">{t("无子类目", "No sub-categories")}</div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        <select value={tiktokL1} onChange={(e) => { setTiktokL1(e.target.value); setTiktokL2(""); selectLeaf("tiktok_category_leaf_id", ""); }} className="w-full px-2 py-2 text-xs border border-slate-200 rounded-lg bg-white">
                          <option value="">Level 1 / 第1级 / Tahap 1</option>
                          {categoryOptions("TikTok Shop", "level1").map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                        <select value={tiktokL2} onChange={(e) => { setTiktokL2(e.target.value); selectLeaf("tiktok_category_leaf_id", ""); }} disabled={!tiktokL1} className="w-full px-2 py-2 text-xs border border-slate-200 rounded-lg bg-white disabled:bg-slate-50">
                          <option value="">Level 2 / 第2级 / Tahap 2</option>
                          {categoryOptions("TikTok Shop", "level2", tiktokL1).map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                        <select value={listingForm.tiktok_category_leaf_id} onChange={(e) => selectLeaf("tiktok_category_leaf_id", e.target.value)} disabled={!tiktokL2} className="w-full px-2 py-2 text-xs border border-slate-200 rounded-lg bg-white disabled:bg-slate-50">
                          <option value="">Level 3 / 第3级 / Tahap 3</option>
                          {categoryOptions("TikTok Shop", "level3", tiktokL1, tiktokL2).map((c) => <option key={c.id} value={c.id}>{c.level3}</option>)}
                        </select>
                      </div>
                    )}
                    {tiktokApiStatus !== "ok" && (() => {
                      const leaf = categoryTrees.find((c) => c.id === listingForm.tiktok_category_leaf_id);
                      return leaf?.commission_rate != null ? (
                        <div className="text-[11px] text-amber-600 mt-1">{t(`预计佣金 ${leaf.commission_rate}%`, `Est. commission ${leaf.commission_rate}%`)}</div>
                      ) : null;
                    })()}
                    {tiktokRealAttrsLoading && <div className="text-[11px] text-slate-400 mt-1">{t("加载官方分类属性中…", "Loading official category attributes…")}</div>}
                  </div>
                )}
              </div>
              <div>
                {/* 品牌 — 平台隔离 (2026-08-25) — TikTok's real Brand API
                    (with reauth fallback) only ever renders on TikTok's
                    page; Shopee's page never calls it and only ever shows
                    a plain free-text brand field. */}
                {listingForm.platform === "TikTok Shop" ? (
                  <>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs text-slate-400">
                        {tiktokBrandsStatus === "ok" ? t("品牌（官方品牌库）", "Brand (official library)") : t("品牌", "Brand")}
                      </div>
                      <button type="button" onClick={generateAiCategoryBrandSuggestion} disabled={aiCatBrandLoading} className="text-[11px] text-indigo-600 hover:text-indigo-800 disabled:text-slate-300">+ {aiCatBrandLoading ? t("生成中…", "Generating…") : t("推荐", "suggestions")}</button>
                    </div>
                    {tiktokBrandsStatus === "ok" && tiktokRealBrands.length > 0 ? (
                      <div className="relative" ref={brandPickerRef}>
                        <button
                          type="button"
                          onClick={() => setShowBrandPicker((v) => !v)}
                          className="w-full flex items-center justify-between px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white hover:border-slate-300 text-left"
                        >
                          <span className={listingForm.brand && listingForm.brand !== "No Brand" ? "text-slate-700" : "text-slate-400"}>
                            {listingForm.brand || "No Brand"}
                          </span>
                          <ChevronDown size={13} className={`text-slate-400 shrink-0 ml-2 transition-transform ${showBrandPicker ? "rotate-180" : ""}`} />
                        </button>
                        {showBrandPicker && (
                          <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg card-3d overflow-hidden">
                            <div className="p-2 border-b border-slate-100">
                              <input
                                autoFocus
                                value={brandSearchQuery}
                                onChange={(e) => setBrandSearchQuery(e.target.value)}
                                placeholder={t(`搜索 ${tiktokRealBrands.length}+ 个品牌`, `Search from ${tiktokRealBrands.length}+ brands`)}
                                className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-slate-400"
                              />
                            </div>
                            <div className="max-h-56 overflow-y-auto">
                              {tiktokRealBrands
                                .filter((b) => !brandSearchQuery.trim() || (b.name || b.brand_name || "").toLowerCase().includes(brandSearchQuery.trim().toLowerCase()))
                                .slice(0, 50)
                                .map((b) => {
                                  const id = String(b.id ?? b.brand_id ?? "");
                                  const name = b.name || b.brand_name || id;
                                  return (
                                    <button key={id} type="button" onClick={() => pickTiktokBrand(b)} className="w-full flex items-center gap-2 text-left px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 border-b border-slate-50 last:border-b-0">
                                      {b.logo_url || b.logo ? (
                                        <img src={b.logo_url || b.logo} alt="" className="h-5 w-5 rounded object-contain shrink-0" />
                                      ) : (
                                        <span className="h-5 w-5 rounded bg-slate-100 text-slate-400 flex items-center justify-center text-[10px] shrink-0">{name[0]?.toUpperCase()}</span>
                                      )}
                                      <span className="truncate">{name}</span>
                                    </button>
                                  );
                                })}
                            </div>
                            <div className="flex items-center justify-between gap-2 p-2 border-t border-slate-100 bg-slate-50">
                              <button type="button" onClick={addCustomBrand} disabled={!brandSearchQuery.trim()} className="text-[11px] text-indigo-600 hover:text-indigo-800 disabled:text-slate-300 disabled:cursor-not-allowed">+ {t("添加新品牌", "Add new brand")}</button>
                              <button type="button" onClick={chooseNoBrand} className="text-[11px] text-slate-500 hover:text-slate-700">{t("选择「无品牌」", "Choose 'No brand'")}</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <input value={listingForm.brand} onChange={(e) => setListingForm({ ...listingForm, brand: e.target.value })} placeholder="No Brand" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs text-slate-400">{t("品牌", "Brand")}</div>
                      <button type="button" onClick={generateAiCategoryBrandSuggestion} disabled={aiCatBrandLoading} className="text-[11px] text-indigo-600 hover:text-indigo-800 disabled:text-slate-300">+ {aiCatBrandLoading ? t("生成中…", "Generating…") : t("推荐", "suggestions")}</button>
                    </div>
                    <input value={listingForm.brand} onChange={(e) => setListingForm({ ...listingForm, brand: e.target.value })} placeholder="No Brand" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                  </>
                )}
              </div>
            </div>
            {/* AI 类目/品牌推荐结果 (2026-08-27, new) — one shared panel for
                both fields since a single generateAiCategoryBrandSuggestion()
                call covers both; each half only renders once it has
                something real to offer (a matched real category / a
                non-empty brand guess). */}
            {catBrandSuggestion && (catBrandSuggestion.categoryMatch || catBrandSuggestion.brand) && (
              <div className="flex flex-wrap items-center gap-2 text-[11px] bg-indigo-50 border border-indigo-100 rounded-lg px-2.5 py-1.5">
                <Sparkles size={11} className="text-indigo-500 shrink-0" />
                <span className="text-slate-400">{t("AI 推荐：", "AI suggests:")}</span>
                {catBrandSuggestion.categoryMatch && (
                  <button type="button" onClick={applySuggestedCategory} className="px-2 py-0.5 rounded-full border border-indigo-200 text-indigo-600 bg-white hover:bg-indigo-100">
                    {t("类目", "Category")}: {catBrandSuggestion.categoryMatch.label}
                  </button>
                )}
                {catBrandSuggestion.brand && (
                  <button type="button" onClick={applySuggestedBrand} className="px-2 py-0.5 rounded-full border border-indigo-200 text-indigo-600 bg-white hover:bg-indigo-100">
                    {t("品牌", "Brand")}: {catBrandSuggestion.brand}
                  </button>
                )}
                <button type="button" onClick={() => setCatBrandSuggestion(null)} className="ml-auto text-slate-300 hover:text-slate-600"><X size={12} /></button>
              </div>
            )}
          </div>

          {/* 3. 详情描述 — 富文本 + 内嵌图片上传 (2026-08-26, upgraded from
              a plain textarea) */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-slate-400">{t("详情描述", "Description")}</div>
              {/* AI 描述生成 (2026-08-26, new) — real Anthropic call via
                  ai-generate Edge Function; see generateAiDescription()
                  above. Overwrites the editor's current content — staff
                  clicking this button are asking for a fresh draft, not an
                  append, same expectation as the title button next to it. */}
              <button
                type="button"
                onClick={generateAiDescription}
                disabled={aiDescLoading}
                className={`text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1 whitespace-nowrap ${aiDescLoading ? "border-slate-100 text-slate-300" : "border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100"}`}
              >
                <Sparkles size={12} className={aiDescLoading ? "animate-spin" : ""} />
                {aiDescLoading ? t("生成中…", "Generating…") : t("AI 描述生成", "AI Description")}
              </button>
            </div>
            <div className="flex items-center gap-2 mb-1.5">
              <label className={`text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer flex items-center gap-1 ${descImageUploading ? "border-slate-100 text-slate-300" : "border-slate-200 hover:bg-slate-50 text-slate-600"}`}>
                <ImageIcon size={12} /> {descImageUploading ? t("上传中…", "Uploading…") : t("插入图片", "Insert Image")}
                <input
                  type="file"
                  accept="image/*"
                  disabled={descImageUploading}
                  onChange={(e) => { insertDescriptionImage(e.target.files?.[0]); e.target.value = ""; }}
                  className="hidden"
                />
              </label>
              <span className="text-[10px] text-slate-400">{t("也可直接粘贴截图", "You can also paste a screenshot directly")}</span>
            </div>
            <div
              ref={descriptionEditorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={syncDescriptionFromEditor}
              onPaste={handleDescriptionPaste}
              onMouseOver={handleDescriptionEditorMouseOver}
              onMouseOut={handleDescriptionEditorMouseOut}
              onClick={handleDescriptionEditorClick}
              className="w-full min-h-[8rem] px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400 [&_img]:max-w-full [&_img]:max-h-[300px] [&_img]:object-contain [&_img]:rounded-lg"
            />
            {descImageError && <div className="text-[11px] text-rose-600 mt-1">{descImageError}</div>}
          </div>

          {/* 4. 商品视频（可选）— 移至详情描述下方 */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs text-slate-400 mb-1 flex items-center gap-1"><Video size={12} /> {t("商品视频（可选）", "Product Video (optional)")}</div>
            <div className="flex items-center gap-2">
              <label className={`text-xs px-3 py-2 rounded-lg border cursor-pointer ${videoUploading ? "border-slate-100 text-slate-300" : "border-slate-200 hover:bg-slate-50 text-slate-600"}`}>
                <Upload size={12} className="inline mr-1" /> {videoUploading ? t("上传中…", "Uploading…") : t("上传视频", "Upload Video")}
                <input type="file" accept="video/*" disabled={videoUploading} onChange={(e) => handleVideoUpload(e.target.files?.[0])} className="hidden" />
              </label>
              {listingForm.video_url && (
                <button onClick={() => setListingForm({ ...listingForm, video_url: "" })} className="text-xs text-rose-500 hover:text-rose-700">{t("移除", "Remove")}</button>
              )}
            </div>
            {videoError && <div className="text-[11px] text-rose-600 mt-1">{videoError}</div>}
            {listingForm.video_url && (
              <video src={listingForm.video_url} controls className="mt-2 w-full max-h-48 rounded-lg border border-slate-200 bg-black" />
            )}
          </div>

          {/* 5. 销售信息与多规格 (2026-08-25: moved inline, no more
              "保存后可在商品清单中管理" placeholder — variants are created
              and edited right here, before the listing is ever saved; see
              persistVariations() in saveListing() for how a brand-new
              listing's rows get attached once it has a real id. */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-slate-500">{t("💰 销售信息与多规格", "💰 Sales Info & Variants")}</div>
              <div className="flex items-center gap-3">
                {/* Auction Product (2026-08-27, new) — TikTok Seller Center
                    has a real time-limited-auction listing type, but this
                    ERP has no bidding/auction backend at all, so the toggle
                    is shown (matching the reference layout) but disabled
                    with an honest "not available" hint rather than faking
                    a working switch. */}
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-not-allowed select-none" title={t("暂未支持拍卖商品", "Auction listings not supported yet")}>
                  {t("拍卖商品", "Auction Product")}
                  <button type="button" disabled className="relative w-9 h-5 rounded-full bg-slate-100 cursor-not-allowed">
                    <span className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white" />
                  </button>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                {t("多规格 (Multiple Variations)", "Multiple Variations")}
                <button
                  type="button"
                  onClick={toggleMultiVariants}
                  className={`relative w-9 h-5 rounded-full transition-colors ${multiVariantsOn ? "bg-purple-600" : "bg-slate-200"}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${multiVariantsOn ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
                </label>
              </div>
            </div>

            {!multiVariantsOn ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-slate-400 mb-1">{t("基础售价 (RM)", "Base Price (RM)")}</div>
                  <input type="number" value={listingForm.base_price} onChange={(e) => setListingForm({ ...listingForm, base_price: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">{t("基础库存 (Stock)", "Stock")}</div>
                  <input type="number" value={listingForm.base_stock} onChange={(e) => setListingForm({ ...listingForm, base_stock: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
                </div>
              </div>
            ) : (
              <>
                {/* 规格1/规格2 — 名称 + chip 式选项编辑器（图片/排序/删除） */}
                <div className="grid grid-cols-2 gap-3">
                  {[1, 2].map((specNum) => {
                    const name = specNum === 1 ? spec1Name : spec2Name;
                    const setName = specNum === 1 ? setSpec1Name : setSpec2Name;
                    const values = specValuesList(specNum);
                    const images = specNum === 1 ? spec1OptionImages : spec2OptionImages;
                    const newOption = specNum === 1 ? spec1NewOption : spec2NewOption;
                    const setNewOption = specNum === 1 ? setSpec1NewOption : setSpec2NewOption;
                    return (
                      <div key={specNum}>
                        <div className="text-xs text-slate-400 mb-1">
                          {specNum === 1 ? t("规格1 名称（如 颜色 / Color）", "Spec 1 name (e.g. Color)") : t("规格2 名称（可选，如 尺寸）", "Spec 2 name (optional, e.g. Size)")}
                        </div>
                        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg mb-1.5" />
                        <div className="space-y-1.5 mb-1.5">
                          {values.map((v, i) => {
                            const uploading = specImageUploading === `${specNum}:${v}`;
                            return (
                              <div key={v} className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-1">
                                <label className={`h-7 w-7 rounded shrink-0 overflow-hidden border border-slate-200 cursor-pointer flex items-center justify-center bg-white ${uploading ? "opacity-50" : ""}`}>
                                  {images[v] ? <img src={images[v]} alt="" className="h-full w-full object-cover" /> : <Camera size={12} className="text-slate-300" />}
                                  <input type="file" accept="image/*" disabled={uploading} onChange={(e) => { uploadSpecOptionImage(specNum, v, e.target.files?.[0]); e.target.value = ""; }} className="hidden" />
                                </label>
                                <span className="flex-1 text-xs truncate">{v}</span>
                                <button onClick={() => moveSpecValue(specNum, v, -1)} disabled={i === 0} className="text-slate-400 hover:text-slate-700 disabled:opacity-20 disabled:cursor-not-allowed">▲</button>
                                <button onClick={() => moveSpecValue(specNum, v, 1)} disabled={i === values.length - 1} className="text-slate-400 hover:text-slate-700 disabled:opacity-20 disabled:cursor-not-allowed">▼</button>
                                <button onClick={() => removeSpecValue(specNum, v)} className="text-rose-400 hover:text-rose-600"><X size={13} /></button>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex gap-1.5">
                          <input
                            value={newOption}
                            onChange={(e) => setNewOption(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSpecValue(specNum, newOption); setNewOption(""); } }}
                            placeholder={specNum === 1 ? t("如 BLACK SPRING，回车添加", "e.g. BLACK SPRING, Enter to add") : t("如 S / M / L，回车添加", "e.g. S / M / L, Enter to add")}
                            className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg"
                          />
                          <button onClick={() => { addSpecValue(specNum, newOption); setNewOption(""); }} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">+</button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={addVariantRow} className="text-xs px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                    + {t("添加规格", "Add Variant")}
                  </button>
                  {variationRows.length > 0 && (
                    <button onClick={() => setShowBatchVariantEdit((v) => !v)} className="text-xs px-3 py-2 rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 ml-auto">
                      <Percent size={12} className="inline mr-1" /> {t(`批量修改${selectedVariantIdx.size > 0 ? `（已选 ${selectedVariantIdx.size}）` : ""}`, `Batch Edit${selectedVariantIdx.size > 0 ? ` (${selectedVariantIdx.size} selected)` : ""}`)}
                    </button>
                  )}
                </div>
                {showBatchVariantEdit && (
                  <div className="flex items-end gap-2 bg-indigo-50 border border-indigo-100 rounded-lg p-2.5">
                    <div>
                      <div className="text-[11px] text-slate-400 mb-1">{t("统一价格 (RM)", "Set price (RM)")}</div>
                      <input type="number" value={batchVariantPrice} onChange={(e) => setBatchVariantPrice(e.target.value)} placeholder={t("留空不改", "blank = no change")} className="w-28 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400 mb-1">{t("统一库存", "Set stock")}</div>
                      <input type="number" value={batchVariantStock} onChange={(e) => setBatchVariantStock(e.target.value)} placeholder={t("留空不改", "blank = no change")} className="w-24 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                    </div>
                    <button
                      onClick={applyBatchVariantEdit}
                      disabled={batchVariantPrice === "" && batchVariantStock === ""}
                      className={`text-xs px-3 py-1.5 rounded-lg text-white ${batchVariantPrice !== "" || batchVariantStock !== "" ? "bg-indigo-600 hover:bg-indigo-700" : "bg-slate-300 cursor-not-allowed"}`}
                    >
                      {t(selectedVariantIdx.size > 0 ? "应用到已选" : "应用到全部", selectedVariantIdx.size > 0 ? "Apply to selected" : "Apply to all")}
                    </button>
                  </div>
                )}

                {/* SKU 卡片列表 */}
                {variationRows.length > 0 && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer">
                      <input type="checkbox" checked={variationRows.length > 0 && selectedVariantIdx.size === variationRows.length} onChange={toggleSelectAllVariants} className="h-3.5 w-3.5 rounded border-slate-300" />
                      {t("全选", "Select all")}
                    </label>
                    {variationRows.map((r, idx) => (
                      <div key={idx} className={`border rounded-lg p-3 ${selectedVariantIdx.has(idx) ? "border-indigo-300 bg-indigo-50/40" : "border-slate-200"}`}>
                        <div className="flex items-start gap-2">
                          <input type="checkbox" checked={selectedVariantIdx.has(idx)} onChange={() => toggleVariantSelect(idx)} className="h-3.5 w-3.5 rounded border-slate-300 mt-2" />
                          {/* Left-side thumbnail box removed (2026-08-26,
                              explicit request) — it was display-only (no
                              upload control of its own, just mirrored
                              spec1OptionImages/spec2OptionImages from the
                              chip editor above), so removing it loses no
                              real functionality; the 规格名称 input is now
                              the first element in this row. */}
                          <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-5 gap-2">
                            <div className="col-span-2 sm:col-span-1">
                              <div className="text-[11px] text-slate-400 mb-0.5">{t("规格名称", "Variant Name")}</div>
                              <input value={r.spec1_value || ""} onChange={(e) => updateVariationField(idx, "spec1_value", e.target.value)} placeholder={t("如 BLACK SPRING", "e.g. BLACK SPRING")} className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                            </div>
                            <div>
                              <div className="text-[11px] text-slate-400 mb-0.5">{t("Retail Price (RM)", "Retail Price (RM)")}</div>
                              <input type="number" value={r.price} onChange={(e) => updateVariationField(idx, "price", e.target.value)} className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                            </div>
                            <div>
                              <div className="text-[11px] text-slate-400 mb-0.5">{t("Stock", "Stock")}</div>
                              <input type="number" value={r.stock} onChange={(e) => updateVariationField(idx, "stock", e.target.value)} className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                            </div>
                            <div>
                              <div className="text-[11px] text-slate-400 mb-0.5">{t("折扣 (%)", "Discount (%)")}</div>
                              <input type="number" min="0" max="100" value={r.discount_percent ?? 0} onChange={(e) => updateVariationField(idx, "discount_percent", e.target.value)} className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                            </div>
                            <div>
                              <div className="text-[11px] text-slate-400 mb-0.5">{t("折后价 (RM)", "Sale Price (RM)")}</div>
                              {/* Client-side computed display only (2026-08-27,
                                  new) — Retail Price × (1 − Discount%), rounded
                                  to cents; not a separate persisted column, so
                                  it always exactly reflects the two real saved
                                  fields it's derived from. */}
                              <div className="w-full px-2 py-1.5 text-xs border border-slate-100 bg-slate-50 rounded-lg text-slate-500">
                                RM {(Number(r.price || 0) * (1 - Math.min(100, Math.max(0, Number(r.discount_percent) || 0)) / 100)).toFixed(2)}
                              </div>
                            </div>
                          </div>
                          <button onClick={() => removeVariationRow(idx)} className="text-rose-400 hover:text-rose-600 mt-2 shrink-0"><Trash2 size={14} /></button>
                        </div>
                        <div className="flex items-center gap-2 mt-2 pl-8">
                          <input value={r.sku || ""} onChange={(e) => updateVariationField(idx, "sku", e.target.value)} placeholder={t("商家 SKU", "Seller SKU")} className="w-28 px-1.5 py-1 text-[11px] border border-slate-200 rounded" />
                          <div className="flex items-center border border-slate-200 rounded overflow-hidden">
                            <input
                              type="number"
                              value={r.weight_kg ?? ""}
                              onChange={(e) => updateVariationField(idx, "weight_kg", e.target.value)}
                              placeholder={t(`重量(${r.weight_unit === "g" ? "g" : "kg"})`, `Weight(${r.weight_unit === "g" ? "g" : "kg"})`)}
                              className="w-16 px-1.5 py-1 text-[11px] border-0 outline-none"
                            />
                            {/* kg/g 单位切换 (2026-08-26, new) — same
                                toggle-button convention as the top-level
                                weight field below; converts the typed
                                number on switch (setVariantWeightUnit),
                                real kg saved to the DB either way. */}
                            <div className="flex text-[10px] border-l border-slate-200 shrink-0">
                              {["kg", "g"].map((u) => (
                                <button
                                  key={u}
                                  type="button"
                                  onClick={() => setVariantWeightUnit(idx, u)}
                                  className={`px-1.5 py-1 ${(r.weight_unit || "kg") === u ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}
                                >
                                  {u}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 6. 包裹与物流信息 */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="text-xs font-medium text-slate-500">{t("📦 包裹与物流信息", "📦 Package & Logistics")}</div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] text-slate-400">{t("重量", "Weight")}</div>
                <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-[11px]">
                  {["g", "kg"].map((u) => (
                    <button key={u} onClick={() => setWeightUnit(u)} className={`px-2 py-0.5 ${listingForm.weight_unit === u ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50"}`}>{u}</button>
                  ))}
                </div>
              </div>
              <input type="number" value={listingForm.weight_kg} onChange={(e) => setListingForm({ ...listingForm, weight_kg: e.target.value })} className="w-full px-2 py-2 text-sm border border-slate-200 rounded-lg mb-1.5" />
              <div className="flex flex-wrap gap-1.5">
                {WEIGHT_QUICK_PRESETS_G.map((g) => (
                  <button key={g} onClick={() => applyWeightPreset(g)} className="text-[11px] px-2 py-0.5 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50">
                    {g >= 1000 ? `${g / 1000}kg` : `${g}g`}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-[11px] text-slate-400 mb-1">{t("长 (cm) *", "L (cm) *")}</div>
                <input type="number" value={listingForm.length_cm} onChange={(e) => setListingForm({ ...listingForm, length_cm: e.target.value })} required className="w-full px-2 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div>
                <div className="text-[11px] text-slate-400 mb-1">{t("宽 (cm) *", "W (cm) *")}</div>
                <input type="number" value={listingForm.width_cm} onChange={(e) => setListingForm({ ...listingForm, width_cm: e.target.value })} required className="w-full px-2 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div>
                <div className="text-[11px] text-slate-400 mb-1">{t("高 (cm) *", "H (cm) *")}</div>
                <input type="number" value={listingForm.height_cm} onChange={(e) => setListingForm({ ...listingForm, height_cm: e.target.value })} required className="w-full px-2 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
            </div>

            {/* TikTok 合规声明 + COD、物流渠道 — 平台隔离 (2026-08-25) —
                only the active platform's section renders; Shopee's page
                never shows TikTok fields and vice versa (no more side-by-
                side dual sections). */}
            {listingForm.platform === "TikTok Shop" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-1">{t("⚠️ TikTok 合规声明", "⚠️ TikTok Compliance")}</div>
                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={listingForm.is_dangerous} onChange={(e) => setListingForm({ ...listingForm, is_dangerous: e.target.checked })} className="h-3.5 w-3.5 rounded border-slate-300" />
                    {t("包含电池/液体/危险品", "Contains batteries/liquid/hazardous")}
                  </label>
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-1 flex items-center gap-1"><Truck size={12} /> {t("货到付款", "Cash on Delivery")}</div>
                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={listingForm.is_cod} onChange={(e) => setListingForm({ ...listingForm, is_cod: e.target.checked })} className="h-3.5 w-3.5 rounded border-slate-300" />
                    {t("支持 COD (Cash on Delivery)", "Support COD")}
                  </label>
                </div>
              </div>
            )}

            {listingForm.platform === "Shopee" && (
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
            )}

            {listingForm.platform === "TikTok Shop" && (
              <div>
                <div className="text-xs font-medium text-slate-500 mb-1">{t("🚚 TikTok 物流渠道", "🚚 TikTok Shipping Channels")}</div>
                <div className="flex flex-wrap gap-2">
                  {TIKTOK_SHIPPING_CHANNELS.map((ch) => (
                    <label key={ch} className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer ${listingForm.tiktok_shipping_channels.includes(ch) ? "bg-rose-50 border-rose-300 text-rose-700" : "border-slate-200 text-slate-500"}`}>
                      <input type="checkbox" checked={listingForm.tiktok_shipping_channels.includes(ch)} onChange={() => toggleTiktokChannel(ch)} className="hidden" />
                      {ch}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {(listingForm.shopee_category_leaf_id || listingForm.tiktok_category_leaf_id || listingForm.tiktok_real_category_id) && (
              <div className="text-[11px] text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-lg px-2.5 py-1.5">
                {t("已根据选中的叶子类目自动带入下方必填属性，请核对填写。", "Attributes below were auto-added from the selected leaf category — please review and fill them in.")}
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-medium text-slate-500">{t("📋 分类必填属性", "📋 Category Attributes")}</div>
                <button onClick={addAttribute} className="text-xs text-indigo-600 hover:text-indigo-800">+ {t("添加属性", "Add")}</button>
              </div>
              <div className="space-y-1.5">
                {listingForm.attributes.map((a, idx) => {
                  // Dropdown + custom value (2026-08-27, new) — only for
                  // attributes whose real TikTok response included an
                  // enumerable `values` list (see selectTiktokRealLeaf);
                  // everything else (free-text attribute types, or any
                  // manually-added row) keeps the plain text input.
                  const hasOptions = Array.isArray(a.options) && a.options.length > 0;
                  const showCustomInput = hasOptions && (customAttrIdx.has(idx) || (a.value && !a.options.includes(a.value)));
                  return (
                    <div key={idx} className="flex gap-2">
                      <input value={a.name} onChange={(e) => updateAttribute(idx, "name", e.target.value)} placeholder={t("属性名（如 Warranty Type）", "Attribute name (e.g. Warranty Type)")} className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                      {hasOptions ? (
                        <div className="flex-1 flex gap-1.5">
                          <select
                            value={showCustomInput ? "__custom__" : a.value}
                            onChange={(e) => {
                              if (e.target.value === "__custom__") {
                                setCustomAttrIdx((prev) => new Set(prev).add(idx));
                                updateAttribute(idx, "value", "");
                              } else {
                                setCustomAttrIdx((prev) => { const next = new Set(prev); next.delete(idx); return next; });
                                updateAttribute(idx, "value", e.target.value);
                              }
                            }}
                            className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"
                          >
                            <option value="">{t("请选择", "Select")}</option>
                            {a.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                            <option value="__custom__">{t("自定义值…", "Enter a custom value…")}</option>
                          </select>
                          {showCustomInput && (
                            <input value={a.value} onChange={(e) => updateAttribute(idx, "value", e.target.value)} placeholder={t("自定义值", "Custom value")} className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                          )}
                        </div>
                      ) : (
                        <input value={a.value} onChange={(e) => updateAttribute(idx, "value", e.target.value)} placeholder={t("值（如 1 Year）", "Value (e.g. 1 Year)")} className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
                      )}
                      <button onClick={() => removeAttribute(idx)} className="text-rose-400 hover:text-rose-600"><Trash2 size={14} /></button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pb-6">
            <button onClick={closeListingForm} className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">{t("取消", "Cancel")}</button>
            <button onClick={saveListing} className="text-sm px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800">{t("保存", "Save")}</button>
          </div>
        </div>
      </div>
    );
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

      {/* 主商品发布清单 — 按当前平台 tab 过滤 (2026-08-25, new) — a Shopee
          listing never shows up while the TikTok Shop tab is active and
          vice versa, matching the platform column each row now carries.
          Legacy rows saved before the platform split (rare, backfilled by
          migration where inferrable) simply won't appear under either tab
          if that inference was ambiguous — reopen via 编辑 isn't needed for
          those since none exist in real data at the time of this change. */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div className="text-sm font-medium">{t(`${activePlatform} 主商品发布清单`, `${activePlatform} Master Listing Catalog`)}</div>
          <button onClick={() => openCreateListing(activePlatform)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800">
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
              {!loading && listings.filter((l) => l.platform === activePlatform).length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-xs text-slate-400">{t("暂无商品，点击「新增商品」开始", 'No listings yet — click "New Listing" to start')}</td></tr>
              )}
              {!loading && listings.filter((l) => l.platform === activePlatform).map((l) => {
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
                      {/* 规格/SKU 变体 (2026-08-25) — moved inline into
                          openEditListing's "5. 销售信息与多规格" section;
                          点击"编辑"即可直接管理变体，不再需要单独入口。 */}
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
            <div className="grid grid-cols-5 gap-2 items-end bg-slate-50 rounded-lg p-3">
              <div>
                <div className="text-[11px] text-slate-400 mb-1">{t("平台", "Platform")}</div>
                <select value={newCategory.platform} onChange={(e) => setNewCategory({ ...newCategory, platform: e.target.value })} className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white">
                  <option value="Shopee">Shopee</option>
                  <option value="TikTok Shop">TikTok Shop</option>
                </select>
              </div>
              <input value={newCategory.level1} onChange={(e) => setNewCategory({ ...newCategory, level1: e.target.value })} placeholder={t("第1级", "Level 1")} className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
              <input value={newCategory.level2} onChange={(e) => setNewCategory({ ...newCategory, level2: e.target.value })} placeholder={t("第2级", "Level 2")} className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
              <input value={newCategory.level3} onChange={(e) => setNewCategory({ ...newCategory, level3: e.target.value })} placeholder={t("第3级", "Level 3")} className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
              <div className="flex gap-1">
                {/* 佣金比例 (2026-08-25, new) — staff-entered reference %,
                    shown as a hint when this leaf is picked in the listing
                    form; not a real platform API value (see migration
                    comment). */}
                <input type="number" value={newCategory.commission_rate} onChange={(e) => setNewCategory({ ...newCategory, commission_rate: e.target.value })} placeholder={t("佣金%", "Commission%")} className="w-16 px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
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
                          {c.commission_rate != null && <span className="text-amber-600 ml-1.5">({c.commission_rate}%)</span>}
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
