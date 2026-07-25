import {
  LayoutDashboard, ShoppingCart, Warehouse, DollarSign, Bot, ShieldCheck,
  Upload, ArrowRightLeft, Store, Megaphone,
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
  return {
    id: account.id,
    platform: DB_TO_DEMO_PLATFORM[account.platform] || account.platform,
    name: account.account_name,
    connectedAt: (account.created_at || "").slice(0, 10),
    status: "已连接",
    syncMode: account.token_expires_at ? "api" : "manual",
  };
}

export function mapDbProduct(p, fallbackShopId) {
  return {
    sku: p.sku,
    name: p.name,
    warehouseA: p.warehouse_a_qty || 0,
    warehouseB: p.warehouse_b_qty || 0,
    reorderPoint: 20,
    shopeeLinked: true,
    tiktokLinked: true,
    listedShop: p.listed_shop_id || fallbackShopId,
  };
}

export function mapDbTransferLog(row) {
  return { id: row.id, type: row.type, sku: row.sku, from: row.from_location, to: row.to_location, qty: row.qty, date: row.created_at };
}

export function mapDbOrder(order, items) {
  const first = items[0] || {};
  return {
    id: order.order_no,
    platformOrderId: order.order_no,
    platform: DB_TO_DEMO_PLATFORM[order.platform] || order.platform,
    customer: order.buyer_name || "—",
    phone: order.buyer_phone || "—",
    address: order.shipping_address || "—",
    sku: first.sku || "",
    skuStatus: first.sku ? "ok" : "missing",
    product: first.product_name || "—",
    productImage: first.image_url || null,
    variation: first.variation || "",
    qty: first.qty || 1,
    unitPrice: Number(first.unit_price || 0),
    shippingFee: Number(order.shipping_fee || 0),
    platformFee: 0,
    commission: 0,
    cost: 0,
    tracking: order.tracking_no || "—",
    courier: order.courier || "—",
    warehouse: "吉隆坡仓",
    status: DB_TO_DEMO_STATUS[order.order_status] || "待处理",
    platformStatus: order.platform_status || null,
    date: (order.order_date || "").slice(0, 10),
    printCount: order.print_count || 0,
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

export const AD_CAMPAIGNS = [
  { id: "AD-001", platform: "Shopee", name: "Shopee 搜索广告 - T恤黑色", sku: "TSH-BLK-M", spend: 320, clicks: 1180, orders: 42, revenue: 1680 },
  { id: "AD-002", platform: "Shopee", name: "Shopee 商品推荐 - 保温瓶", sku: "BOTL-STL-750", spend: 450, clicks: 900, orders: 18, revenue: 900 },
  { id: "AD-003", platform: "Shopee", name: "Shopee 店铺推广 - 全店", sku: "—", spend: 600, clicks: 2100, orders: 30, revenue: 1350 },
  { id: "AD-004", platform: "Shopee", name: "Shopee 搜索广告 - N95口罩", sku: "MASK-N95-50", spend: 180, clicks: 640, orders: 26, revenue: 1170 },
  { id: "AD-005", platform: "TikTok Shop", name: "TikTok 直播间引流", sku: "TSH-BLK-L", spend: 520, clicks: 3400, orders: 55, revenue: 2310 },
  { id: "AD-006", platform: "TikTok Shop", name: "TikTok 短视频广告 - 榴莲干", sku: "SNK-DUR-01", spend: 260, clicks: 1900, orders: 48, revenue: 2016 },
  { id: "AD-007", platform: "TikTok Shop", name: "TikTok 商品卡广告 - 手机壳", sku: "PHON-CASE-13", spend: 210, clicks: 1500, orders: 9, revenue: 189 },
  { id: "AD-008", platform: "TikTok Shop", name: "TikTok GMV Max - 帆布袋", sku: "BAG-CANV-01", spend: 150, clicks: 800, orders: 12, revenue: 300 },
];
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
    border: "border-orange-200", headerBg: "bg-orange-500", chipActive: "bg-orange-500 text-white border-orange-500",
    ring: "focus:border-orange-400",
  },
  "TikTok Shop": {
    dot: "bg-rose-600", text: "text-rose-600", bgWash: "bg-rose-50/60",
    border: "border-rose-200", headerBg: "bg-rose-600", chipActive: "bg-rose-600 text-white border-rose-600",
    ring: "focus:border-rose-400",
  },
};

/* ============================== Nav ============================== */

export const NAV = [
  { key: "overview", zh: "总览", en: "Overview", icon: LayoutDashboard },
  { key: "orders", zh: "订单管理中心", en: "Order Management", icon: ShoppingCart },
  { key: "manualimport", zh: "手动导入订单", en: "Manual Order Import", icon: Upload },
  { key: "inventory", zh: "库存管理", en: "Inventory", icon: Warehouse },
  { key: "productmove", zh: "产品搬仓 / 搬店", en: "Stock Transfer / Shop Move", icon: ArrowRightLeft },
  { key: "stores", zh: "店铺管理", en: "Store Management", icon: Store },
  { key: "finance", zh: "财务与利润", en: "Finance & Profit", icon: DollarSign },
  { key: "ads", zh: "广告费用", en: "Ad Spend", icon: Megaphone },
  { key: "ai", zh: "AI智能功能", en: "AI Features", icon: Bot },
  { key: "roles", zh: "权限管理", en: "Roles & Permissions", icon: ShieldCheck },
];
