import {
  LayoutDashboard, ShoppingCart, Warehouse, DollarSign, Bot, ShieldCheck,
  Upload, ArrowRightLeft, Store, Megaphone, Printer, ClipboardCheck, Tag, Truck, ClipboardList, ClipboardX, Send,
} from "lucide-react";
import { createClient } from "@supabase/supabase-js";

/* ============================== Supabase connection ============================== */

// The anon key is safe to ship to the browser - it has no access on its own,
// every table is locked down with Row Level Security (RLS) requiring a
// logged-in user. See LoginScreen in erp-mvp-demo.jsx for the sign-in flow.
export const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";
export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Maps between our real database's vocabulary and this UI's original demo
// vocabulary, so every existing screen (status colors, warehouse tables,
// platform tabs) keeps working unchanged while showing real data.
export const DB_TO_DEMO_PLATFORM = { shopee: "Shopee", tiktok: "TikTok Shop", telegram: "Telegram" };
export const DB_TO_DEMO_STATUS = {
  pending: "待处理",
  processing: "待处理",
  shipped: "出货",
  returned: "退款中",
  cancelled: "已取消",
};
export const DEMO_TO_DB_STATUS = { 已签收: "shipped", 退款中: "returned" };
export const DEMO_TO_DB_PLATFORM = { Shopee: "shopee", "TikTok Shop": "tiktok", Telegram: "telegram" };

export function mapDbStore(account) {
  // connectionStatus (2026-08-25, new) — real 3-state signal for the
  // 更新连接/退出连接 UI: 'disconnected' comes straight from the DB
  // (set when staff click 退出连接); 'expired' is also DB-driven (set by
  // tiktok-sync-orders when a refresh_token retry fails) OR derived
  // client-side from a past token_expires_at as a same-tick fallback in
  // case the next sync run hasn't caught it yet; otherwise 'connected'.
  // Distinct from the old cosmetic `status` field below (kept as-is,
  // "已连接" hardcoded display text used elsewhere) to avoid touching
  // unrelated existing renders.
  const dbStatus = account.status || "connected";
  const tokenExpired = !!account.token_expires_at && new Date(account.token_expires_at).getTime() < Date.now();
  const connectionStatus = dbStatus === "disconnected" ? "disconnected" : (dbStatus === "expired" || tokenExpired) ? "expired" : "connected";
  return {
    id: account.id,
    platform: DB_TO_DEMO_PLATFORM[account.platform] || account.platform,
    name: account.account_name,
    shopId: account.shop_id || "",
    connectedAt: (account.created_at || "").slice(0, 10),
    status: "已连接",
    connectionStatus,
    lastAuthorizedAt: account.auth_time || null,
    updatedBy: account.updated_by || null,
    syncMode: account.token_expires_at ? "api" : "manual",
    sellerName: account.seller_name || account.account_name || "",
    sellerAddress: account.seller_address || "",
    sellerPhone: account.seller_phone || "",
    // Cosmetic-only, ERP display side — never read by sync/cron logic.
    logoUrl: account.logo_url || "",
    fontColor: account.font_color || "#0f172a",
    fontStyle: account.font_style || "normal",
    badgeColor: account.badge_color || "",
    shopNote: account.shop_note || "",
  };
}

export function mapDbProduct(p, fallbackShopId) {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    warehouseA: p.warehouse_a_qty || 0,
    warehouseB: p.warehouse_b_qty || 0,
    reorderPoint: 20,
    shopeeLinked: true,
    tiktokLinked: true,
    listedShop: p.listed_shop_id || fallbackShopId,
    location: p.location || "",
    locationId: p.location_id || null,
    price: Number(p.price || 0),
    weightKg: Number(p.weight_kg || 0),
    unit: p.unit || "",
    imageUrl: p.image_url || null,
    category: p.category || "",
    brand: p.brand || "",
    partNumber: p.part_number || "",
    barcode: p.barcode || "",
    costPrice: Number(p.cost_price || 0),
    status: p.status || "active",
    autocountItemCode: p.autocount_item_code || "",
  };
}

export function mapDbSupplier(s) {
  return {
    id: s.id,
    name: s.name,
    contactPerson: s.contact_person || "",
    phone: s.phone || "",
    email: s.email || "",
    address: s.address || "",
    paymentTerms: s.payment_terms || "",
    notes: s.notes || "",
    status: s.status || "active",
  };
}

export function mapDbPurchaseOrder(po, items) {
  return {
    id: po.id,
    poNo: po.po_no,
    supplierId: po.supplier_id,
    supplierName: po.supplier_name,
    status: po.status || "draft",
    orderDate: po.order_date,
    expectedDate: po.expected_date || "",
    totalAmount: Number(po.total_amount || 0),
    notes: po.notes || "",
    items: (items || []).map(mapDbPurchaseOrderItem),
  };
}

export function mapDbPurchaseOrderItem(item) {
  return {
    id: item.id,
    productId: item.product_id,
    sku: item.sku,
    productName: item.product_name,
    qty: item.qty || 0,
    unitCost: Number(item.unit_cost || 0),
    subtotal: Number(item.subtotal || 0),
  };
}

export const MOVEMENT_TYPE_LABELS = {
  order_deduction: { zh: "订单出库", en: "Order Deduction" },
  stock_in: { zh: "入库", en: "Stock In" },
  stock_out: { zh: "出库", en: "Stock Out" },
  adjustment: { zh: "库存调整", en: "Adjustment" },
  transfer_out: { zh: "搬出", en: "Transfer Out" },
  transfer_in: { zh: "搬入", en: "Transfer In" },
};

export function mapDbStockMovement(m) {
  return {
    id: m.id,
    sku: m.sku,
    warehouse: m.warehouse || "",
    movementType: m.movement_type,
    qtyChange: m.qty_change ?? (m.qty_deducted ? -m.qty_deducted : 0),
    stockBefore: m.stock_before,
    stockAfter: m.stock_after,
    reason: m.reason || "",
    staffEmail: m.staff_email || "",
    orderId: m.order_id || null,
    purchaseOrderId: m.purchase_order_id || null,
    purchaseOrderItemId: m.purchase_order_item_id || null,
    createdAt: m.created_at,
  };
}

export function mapDbTransferLog(row) {
  return { id: row.id, type: row.type, sku: row.sku, from: row.from_location, to: row.to_location, qty: row.qty, date: row.created_at };
}

export function mapDbAdjustmentRequest(r) {
  return {
    id: r.id,
    productId: r.product_id,
    sku: r.sku,
    qtyChange: r.qty_change,
    reason: r.reason,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    status: r.status,
    approvedBy: r.approved_by || null,
    approvedAt: r.approved_at || null,
    autocountSyncStatus: r.autocount_sync_status,
    autocountDocNo: r.autocount_doc_no || null,
  };
}

export function mapDbCancellationRecord(r) {
  return {
    id: r.id,
    orderId: r.order_id,
    orderNo: r.order_no,
    channel: r.channel,
    sku: r.sku,
    productName: r.product_name || "",
    qty: r.qty,
    customerName: r.customer_name || "",
    reason: r.reason,
    autocountDocNo: r.autocount_doc_no || null,
    autocountDoStatus: r.autocount_do_status || null,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    cancelledAt: r.cancelled_at || null,
  };
}

export function mapDbOrder(order, items) {
  // `items` comes back from a plain `.in("order_id", ...)` select with no
  // ORDER BY (see fetchOrderItemsFor), so Postgres/PostgREST never guarantees
  // row order — for a multi-item order (main product + a Shopee/TikTok
  // free-gift line, e.g. 260817JW253WNF: RK chain set + a RM0 "NOT FOR SELL"
  // gift SKU) that meant `items[0]` could just as easily land on the gift as
  // the real product, and every single-item field below (sku/product/qty/
  // etc — still consumed by print labels, warehouse picking, etc.) would
  // silently show the gift instead. Picking the highest-subtotal item as
  // `first` fixes that deterministically (a free gift's subtotal is always
  // 0) without needing a schema change or an explicit is_gift flag. The full
  // `items` array below (unsorted, real fetch order) is what the order
  // list/detail UI now renders instead of relying on a single item.
  const first = [...items].sort((a, b) => Number(b.subtotal ?? b.unit_price ?? 0) - Number(a.subtotal ?? a.unit_price ?? 0))[0] || {};
  return {
    id: order.order_no,
    platformOrderId: order.order_no,
    platform: DB_TO_DEMO_PLATFORM[order.platform] || order.platform,
    customer: order.buyer_name || "—",
    phone: order.buyer_phone || "—",
    address: order.shipping_address || "—",
    // Real Shopee buyer_user_id (2026-08-20) — order/get_order_detail's
    // optional field, now synced by shopee-sync-orders. Used only to build
    // a buyer-specific Shopee Seller Center webchat deep link from the
    // order drawer's 即时聊天 button; null for TikTok orders (field doesn't
    // apply there, not requested/synced).
    buyerId: order.buyer_user_id || null,
    // Real Shopee buyer_username (2026-08-20) — the buyer's actual account
    // handle (e.g. "muhdizzzat"), NOT masked like buyer_name/phone/address
    // are. Used for the 即时聊天 button's copy-to-clipboard workflow, since
    // Shopee's webchat page doesn't support a ?buyer_id= URL deep link
    // (confirmed live). Null for TikTok orders (not requested/synced there).
    buyerUsername: order.buyer_username || null,
    platformAccountId: order.platform_account_id || null,
    sku: first.sku || "",
    skuStatus: first.sku ? "ok" : "missing",
    product: first.product_name || "—",
    productImage: first.image_url || null,
    variation: first.variation || "",
    qty: first.qty || 1,
    unitPrice: Number(first.unit_price || 0),
    // Full item list (all SKUs on this order — main product(s) + any gift
    // lines), real DB fetch order. Added 2026-08-17 so the order list/detail
    // views can render every item instead of only the single `product`/
    // `sku`/`qty` fields above (which stay as-is for existing consumers —
    // print labels, warehouse picking, stock-deduction displays — that
    // already depend on a single representative item per order).
    items: items.map((it) => ({
      sku: it.sku || "",
      productName: it.product_name || "—",
      image: it.image_url || null,
      variation: it.variation || "",
      qty: it.qty || 1,
      unitPrice: Number(it.unit_price || 0),
      // originalPrice (2026-08-24) — real TikTok list price before any
      // discount (order_items.original_price, synced by tiktok-sync-orders).
      // Falls back to 0 for rows synced before this field existed / for
      // Shopee (never populated there) — consumers must treat 0 as
      // "unknown" and fall back to unitPrice*qty, not as a real zero-price
      // item.
      originalPrice: Number(it.original_price || 0),
      // sellerDiscount (2026-08-26) — real seller-funded discount
      // (order_items.seller_discount, synced by tiktok-sync-orders),
      // separate from TikTok's own platform-funded discount (which is
      // deliberately NOT subtracted from Est. Revenue — see
      // tiktokEstimatedBreakdown's own comment). 0 for rows synced before
      // this field existed, which is the same as "no seller discount" —
      // no separate "unknown" state needed here (unlike originalPrice)
      // since 0 is always a safe, honest default for a discount amount.
      sellerDiscount: Number(it.seller_discount || 0),
    })),
    shippingFee: Number(order.shipping_fee || 0),
    platformFee: 0,
    commission: 0,
    cost: 0,
    tracking: order.tracking_no || "—",
    courier: order.courier || "—",
    warehouse: "吉隆坡仓",
    status: DB_TO_DEMO_STATUS[order.order_status] || "待处理",
    // Raw DB order_status (pending/processing/shipped/returned/cancelled),
    // kept alongside the collapsed `status` label above — DB_TO_DEMO_STATUS
    // maps both pending and processing to the same "待处理" label, so this
    // is the only way the UI can actually tell them apart (needed for the
    // Confirm Process button, which should only show/act on true 'pending').
    orderStatus: order.order_status || "pending",
    platformStatus: order.platform_status || null,
    warehouseStage: order.warehouse_stage || "pending",
    cancelStage: order.cancel_stage || null,
    isCod: order.is_cod || false,
    date: (order.order_date || "").slice(0, 10),
    // Real platform ship-by deadline (TikTok's cancel_order_sla_time), when
    // the sync has captured it for this order — null for rows not yet
    // re-synced since this field was added, or where the platform doesn't
    // return it. Consumers fall back to their own estimate when null.
    shipDeadline: order.ship_deadline || null,
    // Real TikTok delivery option label ("Instant", "Next-day delivery",
    // "Standard shipping"), when the sync has captured it — null for rows
    // not yet re-synced since this field was added, or Shopee orders.
    deliveryOption: order.delivery_option || null,
    printCount: order.print_count || 0,
    lastPrintedAt: order.last_printed_at || null,
    lastPrintedBy: order.last_printed_by || null,
    noteColor: order.note_color || null,
    noteText: order.note_text || "",
  };
}

/* ============================== Mock data ============================== */

export const STATUS_STEPS = ["待处理", "包装", "出货", "物流中", "已签收"];
export const EXTRA_STATUS = ["已取消", "退款中"];
export const ACTIONABLE_STATUS = ["出货", "物流中"];

export const PRODUCTS = [
  { sku: "TSH-BLK-M", name: "纯棉圆领T恤 黑色 M码", cost: 18 },
  { sku: "TSH-BLK-L", name: "纯棉圆领T恤 黑色 L码", cost: 18 },
  { sku: "MASK-N95-50", name: "N95口罩 50片装", cost: 22 },
  { sku: "BOTL-STL-750", name: "不锈钢保温瓶 750ml", cost: 26 },
  { sku: "BAG-CANV-01", name: "帆布手提袋", cost: 9 },
  { sku: "PHON-CASE-13", name: "手机壳 iPhone 13", cost: 6 },
  { sku: "SNK-DUR-01", name: "榴莲干 200g", cost: 14 },
];

const CUSTOMERS = ["陈美玲", "李伟强", "Nurul Ain", "Tan Wei Jie", "Farah Aziz", "Kevin Ooi", "Siti Aminah", "Wong Kah Yan"];
const ADDRESSES = [
  "No. 12, Jalan Bunga Raya 3, Taman Sri Rampai, 53300 Kuala Lumpur",
  "88, Jalan Molek 2/4, Taman Molek, 81100 Johor Bahru, Johor",
  "23A, Persiaran Klang, 41200 Klang, Selangor",
  "56, Jalan Sutera Tanjung 8/2, Taman Sutera Utama, 81300 Skudai, Johor",
  "17, Jalan Ampang Utama 1/1, 68000 Ampang, Selangor",
];
const PHONES = ["012-3456789", "011-22334455", "016-7889012", "019-5432100", "013-8765432"];

export const INITIAL_STORES = [
  { id: "shopee-main", platform: "Shopee", name: "Shopee 官方旗舰店", connectedAt: "2025-03-12", status: "已连接", syncMode: "manual" },
  { id: "shopee-old", platform: "Shopee", name: "Shopee 旧店铺（待淘汰）", connectedAt: "2023-08-01", status: "已连接", syncMode: "manual" },
  { id: "tiktok-main", platform: "TikTok Shop", name: "TikTok Shop 主账号", connectedAt: "2025-11-20", status: "已连接", syncMode: "manual" },
];

function buildInventoryStoreAssignment() {
  // 每个 SKU 默认挂在旧店铺，方便演示"把商品从旧店铺搬去新店铺"
  const map = {};
  PRODUCTS.forEach((p, i) => {
    map[p.sku] = i % 2 === 0 ? "shopee-old" : "shopee-main";
  });
  return map;
}

export function buildOrders() {
  const platforms = ["Shopee", "TikTok Shop"];
  const warehouses = ["吉隆坡仓", "柔佛仓"];
  const statuses = [...STATUS_STEPS, ...EXTRA_STATUS];
  const rows = [];
  for (let i = 0; i < 26; i++) {
    const product = PRODUCTS[i % PRODUCTS.length];
    const platform = platforms[i % 2];
    const qty = 1 + (i % 3);
    const unitPrice = 19.9 + (i % 5) * 8.3;
    const shippingFee = 4.5 + (i % 4);
    const platformFee = +(unitPrice * qty * 0.02).toFixed(2);
    const commission = +(unitPrice * qty * (platform === "Shopee" ? 0.06 : 0.05)).toFixed(2);
    const status = statuses[i % statuses.length];
    const day = 15 - (i % 14);
    rows.push({
      id: `${platform === "Shopee" ? "SP" : "TT"}-202607${String(10 + (i % 5)).padStart(2, "0")}-${String(900 + i)}`,
      platform,
      customer: CUSTOMERS[i % CUSTOMERS.length],
      phone: PHONES[i % PHONES.length],
      address: ADDRESSES[i % ADDRESSES.length],
      sku: product.sku,
      product: product.name,
      qty,
      unitPrice: +unitPrice.toFixed(2),
      shippingFee: +shippingFee.toFixed(2),
      platformFee,
      commission,
      cost: product.cost,
      tracking: `MY${1000000000 + i * 7654321}`,
      warehouse: warehouses[i % 2],
      status,
      date: `2026-07-${String(day).padStart(2, "0")}`,
    });
  }
  return rows;
}

export function buildInventory() {
  const shopMap = buildInventoryStoreAssignment();
  return PRODUCTS.map((p, i) => {
    const a = [42, 12, 8, 55, 30, 5, 60][i % 7];
    const b = [15, 6, 4, 20, 10, 3, 18][i % 7];
    return {
      sku: p.sku, name: p.name, warehouseA: a, warehouseB: b, reorderPoint: 35,
      shopeeLinked: true, tiktokLinked: i % 4 !== 0, listedShop: shopMap[p.sku],
    };
  });
}

export const SALES_TREND = Array.from({ length: 14 }).map((_, i) => {
  const day = i + 1;
  const base = 1800 + Math.sin(i / 2) * 400 + (i > 9 ? 500 : 0);
  return { day: `7/${day}`, Shopee: Math.round(base * 0.55), "TikTok Shop": Math.round(base * 0.45) };
});

export const ROLES = [
  { role: "管理员", users: 2, perms: { 订单: true, 库存: true, 财务: true, AI: true, 权限: true } },
  { role: "运营专员", users: 5, perms: { 订单: true, 库存: true, 财务: false, AI: true, 权限: false } },
  { role: "仓管", users: 3, perms: { 订单: true, 库存: true, 财务: false, AI: false, 权限: false } },
  { role: "财务", users: 1, perms: { 订单: false, 库存: false, 财务: true, AI: false, 权限: false } },
  { role: "客服", users: 4, perms: { 订单: true, 库存: false, 财务: false, AI: true, 权限: false } },
];

// AD_CAMPAIGNS mock array removed (2026-08-24) — 广告费用 (AdsSpend) now
// reads real data from the `ad_campaigns` Supabase table (staff-entered;
// see the data-source note above the AdsSpend component in
// pagesImportFinance.jsx for why there's no real Ads API behind it).
export const AD_ROAS_THRESHOLD = 3;

/* ============================== Helpers ============================== */

export function profit(o) {
  return +(o.unitPrice * o.qty - o.shippingFee - o.platformFee - o.commission - o.cost * o.qty).toFixed(2);
}
export function fmt(n) {
  return n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function statusColor(status) {
  const map = {
    待处理: "bg-amber-100 text-amber-700 border-amber-200",
    包装: "bg-indigo-100 text-indigo-700 border-indigo-200",
    出货: "bg-blue-100 text-blue-700 border-blue-200",
    物流中: "bg-cyan-100 text-cyan-700 border-cyan-200",
    已签收: "bg-emerald-100 text-emerald-700 border-emerald-200",
    已取消: "bg-slate-200 text-slate-600 border-slate-300",
    退款中: "bg-rose-100 text-rose-700 border-rose-200",
  };
  return map[status] || "bg-slate-100 text-slate-600 border-slate-200";
}

const STATUS_EN = {
  待处理: "Pending",
  包装: "Packing",
  出货: "Shipped Out",
  物流中: "In Transit",
  已签收: "Delivered",
  已取消: "Cancelled",
  退款中: "Refunding",
};
export function statusLabel(status, lang) {
  return lang === "en" ? STATUS_EN[status] || status : status;
}

const WAREHOUSE_EN = { 吉隆坡仓: "KL Warehouse", 柔佛仓: "Johor Warehouse" };
export function warehouseLabel(name, lang) {
  return lang === "en" ? WAREHOUSE_EN[name] || name : name;
}

export const PLATFORM_THEME = {
  Shopee: {
    dot: "bg-orange-500", text: "text-orange-600", bgWash: "bg-orange-50/60",
    border: "border-orange-200", headerBg: "bg-gradient-to-r from-orange-500 to-orange-600", chipActive: "bg-orange-500 text-white border-orange-500",
    ring: "focus:border-orange-400",
  },
  "TikTok Shop": {
    dot: "bg-rose-600", text: "text-rose-600", bgWash: "bg-rose-50/60",
    border: "border-rose-200", headerBg: "bg-gradient-to-r from-rose-600 to-rose-700", chipActive: "bg-rose-600 text-white border-rose-600",
    ring: "focus:border-rose-400",
  },
};

/* ============================== Nav ============================== */

export const NAV = [
  { key: "overview", zh: "总览", en: "Overview", icon: LayoutDashboard },
  // "订单管理中心" — merged 2026-07-28 (per a reference screenshot) into one
  // page: the status-card dashboard (formerly a separate "orderCenter" tab)
  // now renders inside the Orders component itself, above its existing
  // platform tabs/filters/list. This nav entry is that same single page.
  { key: "orders", zh: "订单管理中心", en: "Order Management Center", icon: ShoppingCart },
  { key: "manualimport", zh: "自动导入订单", en: "Auto Order Import", icon: Upload },
  { key: "products", zh: "商品管理", en: "Product Master", icon: Tag },
  { key: "productlisting", zh: "商品发布中心", en: "Product Listing Center", icon: Store },
  { key: "suppliers", zh: "供应商管理", en: "Supplier Management", icon: Truck },
  { key: "purchaseorders", zh: "采购订单", en: "Purchase Orders", icon: ClipboardList },
  { key: "inventory", zh: "库存管理", en: "Inventory", icon: Warehouse },
  { key: "productmove", zh: "产品搬仓 / 搬店", en: "Stock Transfer / Shop Move", icon: ArrowRightLeft },
  { key: "finance", zh: "财务与利润", en: "Finance & Profit", icon: DollarSign },
  { key: "ads", zh: "广告费用", en: "Ad Spend", icon: Megaphone },
  { key: "ai", zh: "AI智能功能", en: "AI Features", icon: Bot },
  { key: "labels", zh: "标签打印", en: "Label Printing", icon: Printer },
  { key: "roles", zh: "权限管理", en: "Roles & Permissions", icon: ShieldCheck },
];
