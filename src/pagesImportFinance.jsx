import { useState, useEffect, useRef, Fragment } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import JsBarcode from "jsbarcode";
import { QRCodeSVG } from "qrcode.react";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Info, TrendingUp,
  DollarSign, Sparkles, Bot, Send, Users, Megaphone, Printer, X, Settings, Package, GripVertical, Plus,
  SlidersHorizontal, History, Eye, ChevronDown, Search, Pencil, Trash2, KeyRound, Ban, ShieldCheck,
  Zap, Rocket,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  PRODUCTS, PLATFORM_THEME, AD_ROAS_THRESHOLD,
  fmt, statusLabel, warehouseLabel, supabaseClient, mapDbOrder, DEMO_TO_DB_PLATFORM,
} from "./shared.jsx";
import { KPICard as KPICardImpl } from "./pagesOverviewOrders.jsx";

/* ============================== Manual import (手动导入订单，暂无API时使用) ============================== */

const CSV_TEMPLATE_HEADERS = ["order_id", "customer", "phone", "address", "sku", "product", "qty", "unit_price", "shipping_fee", "tracking", "date"];
const CSV_TEMPLATE_EXAMPLE = ["SP-20260717-001", "陈美玲", "012-3456789", "No.1 Jalan Contoh, KL", "TSH-BLK-M", "纯棉圆领T恤 黑色 M码", "2", "39.90", "6.50", "MY1234567890", "2026-07-17"];

function downloadCsvTemplate() {
  const csv = [CSV_TEMPLATE_HEADERS.join(","), CSV_TEMPLATE_EXAMPLE.join(",")].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "订单导入模板.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function skuStatus(sku, inventory) {
  if (!sku || !sku.trim()) return "missing";
  const found = inventory.some((i) => i.sku.toLowerCase() === sku.trim().toLowerCase());
  return found ? "ok" : "unlinked";
}

function isShopeeExportRow(raw) {
  return raw && "Order ID" in raw && "SKU Reference No." in raw;
}

function normalizeShopeeRow(raw, orderIdCounter) {
  const rawOrderId = String(raw["Order ID"] || "").trim();
  const seen = orderIdCounter.get(rawOrderId) || 0;
  orderIdCounter.set(rawOrderId, seen + 1);
  const id = seen === 0 ? rawOrderId : `${rawOrderId}-${seen + 1}`;

  const qty = Number(raw["Quantity"]) || 1;
  const unitPrice = Number(raw["Deal Price"]) || Number(raw["Original Price"]) || 0;
  const commissionFee = Number(raw["Commission Fee"]) || 0;
  const transactionFee = Number(raw["Transaction Fee"]) || 0;
  const serviceFee = Number(raw["Service Fee"]) || 0;
  const estShippingFee = Number(raw["Estimated Shipping Fee"]) || 0;
  const variation = String(raw["Variation Name"] || "").trim();
  const productName = String(raw["Product Name"] || "").trim();
  const orderDate = String(raw["Order Paid Time"] || raw["Order Creation Date"] || "").slice(0, 10);

  return {
    order_id: id,
    platform_order_id: rawOrderId,
    customer: String(raw["Receiver Name"] || raw["Username (Buyer)"] || "—").trim() || "—",
    phone: String(raw["Phone Number"] || "—").trim() || "—",
    address: String(raw["Delivery Address"] || "—").trim() || "—",
    sku: String(raw["SKU Reference No."] || "").trim(),
    product: variation ? `${productName} - ${variation}` : productName,
    qty,
    unit_price: unitPrice,
    shipping_fee: estShippingFee,
    tracking: String(raw["Tracking Number*"] || "").trim() || "—",
    date: orderDate || new Date().toISOString().slice(0, 10),
    commission_fee: commissionFee,
    platform_fee: +(transactionFee + serviceFee).toFixed(2),
    platform_status: String(raw["Order Status"] || "").trim(),
  };
}

function isTiktokExportRow(raw) {
  return raw && "Seller SKU" in raw && "SKU ID" in raw && "Recipient" in raw;
}

function parseDmyDateTime(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const datePart = s.split(" ")[0];
  const parts = datePart.split("/");
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function normalizeTiktokRow(raw, orderIdCounter) {
  const rawOrderId = String(raw["Order ID"] || "").trim();
  const seen = orderIdCounter.get(rawOrderId) || 0;
  orderIdCounter.set(rawOrderId, seen + 1);
  const id = seen === 0 ? rawOrderId : `${rawOrderId}-${seen + 1}`;

  const qty = Number(raw["Quantity"]) || 1;
  const subtotalAfterDiscount = Number(raw["SKU Subtotal After Discount"]) || 0;
  const unitPrice = qty > 0 ? +(subtotalAfterDiscount / qty).toFixed(2) : subtotalAfterDiscount;
  const shippingFee = Number(raw["Original Shipping Fee"]) || 0;
  const variation = String(raw["Variation"] || "").trim();
  const productName = String(raw["Product Name"] || "").trim();
  const date = parseDmyDateTime(raw["Paid Time"]) || parseDmyDateTime(raw["Created Time"]) || new Date().toISOString().slice(0, 10);

  return {
    order_id: id,
    platform_order_id: rawOrderId,
    customer: String(raw["Recipient"] || raw["Buyer Username"] || "—").trim() || "—",
    phone: String(raw["Phone #"] || "—").trim() || "—",
    address: String(raw["Detail Address"] || "—").trim() || "—",
    sku: String(raw["Seller SKU"] || "").trim(),
    product: variation ? `${productName} - ${variation}` : productName,
    qty,
    unit_price: unitPrice,
    shipping_fee: shippingFee,
    tracking: String(raw["Tracking ID"] || "").trim() || "—",
    date,
    platform_status: String(raw["Order Status"] || "").trim(),
  };
}

export function ManualImport({ t, stores, inventory, onImport }) {
  const [storeId, setStoreId] = useState(stores[0]?.id || "");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [imported, setImported] = useState(0);
  const [sourceType, setSourceType] = useState("");

  const store = stores.find((s) => s.id === storeId);
  const rowsWithStatus = rows.map((r) => ({ ...r, __status: skuStatus(r.sku, inventory) }));
  const missingSkuRows = rowsWithStatus.filter((r) => r.__status === "missing");
  const unlinkedSkuRows = rowsWithStatus.filter((r) => r.__status === "unlinked");

  function processRawRows(raw) {
    if (!raw || raw.length === 0) {
      setError(t("文件里没有解析到任何数据行，请确认文件内容", "No data rows found in the file — please check the file content"));
      setRows([]);
      return;
    }
    if (isShopeeExportRow(raw[0])) {
      const counter = new Map();
      setSourceType("shopee");
      setRows(raw.map((r) => normalizeShopeeRow(r, counter)));
      return;
    }
    if (isTiktokExportRow(raw[0])) {
      const counter = new Map();
      setSourceType("tiktok");
      setRows(raw.map((r) => normalizeTiktokRow(r, counter)));
      return;
    }
    const fields = Object.keys(raw[0]);
    const missing = CSV_TEMPLATE_HEADERS.filter((h) => !fields.includes(h));
    if (missing.length > 0) {
      setError(
        t(
          `识别不出这个文件的格式：既不是 Shopee/TikTok Shop 官方导出，也缺少通用模板的必要栏位（${missing.join("、")}）。可以直接上传平台后台导出的原始文件，或对照"下载CSV模板"来填。`,
          `Couldn't recognize this file format: it's neither a Shopee/TikTok Shop official export nor does it have the required template columns (${missing.join(", ")}). Upload the platform's original export file, or fill in the "Download CSV Template".`,
        ),
      );
      setRows([]);
      return;
    }
    setSourceType("template");
    setRows(raw);
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError("");
    setImported(0);
    setSourceType("");

    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const wb = XLSX.read(evt.target.result, { type: "array" });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const raw = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
          processRawRows(raw);
        } catch (err) {
          setError(t(`Excel 文件解析失败：${err.message}`, `Failed to parse Excel file: ${err.message}`));
        }
      };
      reader.onerror = () => setError(t("文件读取失败，请重试", "Failed to read file, please try again"));
      reader.readAsArrayBuffer(file);
    } else {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => processRawRows(results.data),
        error: (err) => setError(t(`文件解析失败：${err.message}`, `Failed to parse file: ${err.message}`)),
      });
    }
  }

  function handleImport() {
    if (!store || rows.length === 0) return;
    const now = new Date();
    const mapped = rows.map((r, i) => {
      const qty = Number(r.qty) || 1;
      const unitPrice = Number(r.unit_price) || 0;
      const shippingFee = Number(r.shipping_fee) || 0;
      const sku = (r.sku || "").trim();
      const status = skuStatus(sku, inventory);
      const hasRealFees = r.commission_fee !== undefined && r.platform_fee !== undefined;
      return {
        id: r.order_id || `MANUAL-${now.getTime()}-${i}`,
        platformOrderId: r.platform_order_id || undefined,
        platformStatus: r.platform_status || undefined,
        platform: store.platform,
        shop: store.id,
        customer: r.customer || "—",
        phone: r.phone || "—",
        address: r.address || "—",
        sku,
        skuStatus: status,
        skuMissing: status !== "ok",
        product: r.product || sku || t("未命名商品", "Unnamed Product"),
        qty,
        unitPrice,
        shippingFee,
        platformFee: hasRealFees ? +Number(r.platform_fee).toFixed(2) : +(unitPrice * qty * 0.02).toFixed(2),
        commission: hasRealFees ? +Number(r.commission_fee).toFixed(2) : +(unitPrice * qty * (store.platform === "Shopee" ? 0.06 : 0.05)).toFixed(2),
        cost: 0,
        tracking: r.tracking || "—",
        warehouse: "吉隆坡仓",
        status: "待处理",
        date: r.date || now.toISOString().slice(0, 10),
      };
    });
    onImport(mapped);
    setImported(mapped.length);
    setRows([]);
    setFileName("");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 bg-sky-50 border border-sky-200 rounded-xl px-4 py-3">
        <Info size={16} className="text-sky-600 shrink-0" />
        <div className="text-xs text-sky-800">
          {t(
            "在还没申请到 Shopee / TikTok Shop 官方 API 之前，先用这里导入订单数据——可以直接上传",
            "Before getting official Shopee / TikTok Shop API access, use this to import order data — you can directly upload the ",
          )}
          <strong>{t("平台后台导出的原始文件", "platform's original export file")}</strong>
          {t(
            "（Shopee 的\"Order_toship_xxx.xlsx\"、TikTok Shop 的\"To_Ship_order-xxx.csv\"都支持），系统会自动识别栏位并转换；也可以用我们自己的CSV模板。等以后拿到 API，去\"店铺管理\"把对应店铺切换成\"API自动同步\"即可，这个手动导入功能到时候就不需要再用了，系统架构不用改。",
            " (Shopee's \"Order_toship_xxx.xlsx\", TikTok Shop's \"To_Ship_order-xxx.csv\" both supported) — the system auto-detects the columns and converts them; or use our own CSV template. Once you get API access later, switch that store to \"API Auto-Sync\" in Store Management — this manual import feature simply won't be needed anymore, no architecture changes required.",
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="text-sm font-medium flex items-center gap-1.5">
          <Upload size={14} className="text-teal-500" /> {t("上传订单文件", "Upload Order File")}
        </div>

        <div>
          <label className="text-xs text-slate-500 mb-1 block">{t("导入到哪个店铺", "Import to which store")}</label>
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-teal-400"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}（{s.platform}）{s.syncMode === "api" ? t(" · 已有API，通常不需要手动导入", " · Has API, manual import usually not needed") : ""}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-slate-300 cursor-pointer hover:bg-slate-50">
            <Upload size={14} />
            {t("选择文件（.xlsx / .csv）", "Choose File (.xlsx / .csv)")}
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} className="hidden" />
          </label>
          <button
            onClick={downloadCsvTemplate}
            className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <FileSpreadsheet size={14} /> {t("下载CSV模板", "Download CSV Template")}
          </button>
          {fileName && <span className="text-xs text-slate-400">{t("已选择：", "Selected: ")}{fileName}</span>}
          {sourceType === "shopee" && (
            <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1">
              <CheckCircle2 size={11} /> {t("已识别为 Shopee 官方导出格式，自动带入真实佣金/手续费/运费", "Recognized as Shopee official export format — real commission/fees/shipping auto-filled")}
            </span>
          )}
          {sourceType === "tiktok" && (
            <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1">
              <CheckCircle2 size={11} /> {t("已识别为 TikTok Shop 官方导出格式（佣金/手续费该文件未提供，暂用估算）", "Recognized as TikTok Shop official export format (commission/fees not provided, estimated for now)")}
            </span>
          )}
          {sourceType === "template" && (
            <span className="text-[11px] px-2 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200 inline-flex items-center gap-1">
              <FileSpreadsheet size={11} /> {t("通用CSV模板格式", "Generic CSV Template Format")}
            </span>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border bg-rose-50 text-rose-600 border-rose-200">
            <AlertTriangle size={13} /> {error}
          </div>
        )}

        {imported > 0 && (
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border bg-emerald-50 text-emerald-700 border-emerald-200">
            <CheckCircle2 size={13} /> {t(`已成功导入 ${imported} 笔订单到「${store?.name}」`, `Successfully imported ${imported} order(s) to "${store?.name}"`)}
          </div>
        )}

        {rows.length > 0 && (
          <div>
            <div className="text-xs text-slate-500 mb-2">{t(`预览（共 ${rows.length} 笔，导入到「${store?.name}」）`, `Preview (${rows.length} total, importing to "${store?.name}")`)}</div>

            {missingSkuRows.length > 0 && (
              <div className="flex items-center gap-2 text-xs px-3 py-2 mb-2 rounded-lg border bg-rose-50 text-rose-600 border-rose-200">
                <AlertTriangle size={13} className="shrink-0" />
                {t(
                  `有 ${missingSkuRows.length} 笔记录 CSV 里根本没填 SKU（下方红色标出），导入后会标注"缺SKU"。`,
                  `${missingSkuRows.length} row(s) have no SKU filled in the CSV at all (marked red below) — will be flagged "Missing SKU" after import.`,
                )}
              </div>
            )}
            {unlinkedSkuRows.length > 0 && (
              <div className="flex items-center gap-2 text-xs px-3 py-2 mb-2 rounded-lg border bg-amber-50 text-amber-700 border-amber-200">
                <AlertTriangle size={13} className="shrink-0" />
                {t(
                  `有 ${unlinkedSkuRows.length} 笔记录填了 SKU，但我们系统库存里没有登记这个 SKU（下方橙色标出）——多半是平台那边的商品还没跟系统对应上，导入后会标注"系统未登记"，库存也不会自动扣减，需要先去库存里补建这个 SKU 或修正对应关系。`,
                  `${unlinkedSkuRows.length} row(s) have an SKU filled in but it's not registered in our inventory (marked amber below) — usually because the platform's product isn't mapped to the system yet. Will be flagged "Not Registered" after import and stock won't auto-deduct; add this SKU to Inventory first or fix the mapping.`,
                )}
              </div>
            )}

            <div className="border border-slate-200 rounded-lg overflow-auto max-h-64">
              <table className="w-full text-xs min-w-[900px]">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="text-left text-slate-400">
                    {CSV_TEMPLATE_HEADERS.map((h) => (<th key={h} className="py-2 px-2 font-medium">{h}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {rowsWithStatus.slice(0, 20).map((r, i) => {
                    const rowBg = r.__status === "missing" ? "bg-rose-50" : r.__status === "unlinked" ? "bg-amber-50" : "";
                    const skuCellClass = r.__status === "missing" ? "text-rose-600 font-medium" : r.__status === "unlinked" ? "text-amber-700 font-medium" : "text-slate-600";
                    return (
                      <tr key={i} className={`border-t border-slate-100 ${rowBg}`}>
                        {CSV_TEMPLATE_HEADERS.map((h) => (
                          <td key={h} className={`py-1.5 px-2 ${h === "sku" ? skuCellClass : "text-slate-600"}`}>
                            {h === "sku" ? (r.__status === "missing" ? t("⚠ 缺失", "⚠ Missing") : r.__status === "unlinked" ? t(`⚠ ${r.sku}（系统未登记）`, `⚠ ${r.sku} (not registered)`) : r.sku) : r[h]}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button
              onClick={handleImport}
              className="mt-3 flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
            >
              <Upload size={14} /> {t(`确认导入 ${rows.length} 笔订单`, `Confirm Import (${rows.length})`)}
              {(missingSkuRows.length > 0 || unlinkedSkuRows.length > 0) &&
                t(`（缺SKU ${missingSkuRows.length} 笔，系统未登记 ${unlinkedSkuRows.length} 笔）`, ` (Missing SKU: ${missingSkuRows.length}, Not Registered: ${unlinkedSkuRows.length})`)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================== Finance ============================== */

// Estimated platform fee/commission (2026-08-18, explicit approval) —
// `orders` has no real platform_fee/commission_fee/service_fee column at
// all yet (confirmed: not a sync bug, this was simply never built — see
// project_finance_revenue_page_spec memory). Until the real Shopee Escrow /
// TikTok Settlement API is wired in, these are placeholder estimates from
// fixed rates so 净利润 isn't silently just revenue. Deliberately scoped to
// this Finance page only (not shared.jsx's profit(), which Overview's 净利润
// KPI and Order Management Center still use unchanged) so no other page's
// numbers are affected. Every value derived from this must stay visibly
// marked "预估" per explicit instruction — never presented as a real
// platform-charged fee.
// ---- Fee Rate Profile (adjustable, 2026-08-19) -------------------------
// Extracted per explicit request so a rate change is a one-line edit here,
// nowhere else. NOT official published platform rates — Shopee/TikTok
// don't publish one fixed %, real per-order fees vary by category/
// campaign (confirmed against real get_escrow_detail / statement_
// transactions responses earlier this session). service+transaction is a
// convenience split of the old single 2% "platform fee" number this page
// has used since the estimate was first built (still sums to 2%) — not a
// verified official per-component breakdown, just editable independently
// now that Commission / Service Fee / Transaction Fee are named line
// items on the real settlement side too.
const FEE_RATE_PROFILE = {
  Shopee: { commission: 0.06, service: 0.01, transaction: 0.01 },
  "TikTok Shop": { commission: 0.05, service: 0.01, transaction: 0.01 },
};
export function platformFeeRate(platform) {
  const r = FEE_RATE_PROFILE[platform] || { commission: 0, service: 0, transaction: 0 };
  return { total: r.commission + r.service + r.transaction, ...r };
}
// Anomaly threshold (2026-08-19, new) — once a real settlement lands,
// flag red when it diverges from the formula estimate by more than this,
// per explicit request ("差異超過 RM 1.00 時，以紅色標示異常").
const FEE_ANOMALY_THRESHOLD = 1.0;
const EST_FEE_TOOLTIP = "*预估费用，等待 API 结算账单对接（非平台真实扣款）";

function estimatedFees(o) {
  const gross = o.unitPrice * o.qty;
  const rate = platformFeeRate(o.platform);
  return {
    platformFee: +(gross * (rate.service + rate.transaction)).toFixed(2),
    commission: +(gross * rate.commission).toFixed(2),
  };
}

// 净利润(预估) = 商品金额 + 运费收入 - 预估平台费用与佣金 - 商品成本 (explicit
// formula, 2026-08-18) — shipping fee is treated as income here, unlike
// shared.jsx's profit() which subtracts it; a deliberately separate
// function/formula, not a change to profit() itself.
function estimatedProfit(o) {
  const { platformFee, commission } = estimatedFees(o);
  return +(o.unitPrice * o.qty + o.shippingFee - platformFee - commission - o.cost * o.qty).toFixed(2);
}

// Shopee-Income-Details-style breakdown for one order's real settlement row
// (2026-08-18) — every number here comes from the real stored columns /
// raw_response written by shopee-settlement-sync / tiktok-settlement-sync,
// nothing estimated (only rows with a real settlement are expandable at
// all — see the chevron gating in the JSX below). The itemized fee lines
// won't always sum to exactly Order Income to the cent (Shopee/TikTok's
// real responses carry many more minor real fields than are broken out
// here individually) — the bold Order Income total itself is always the
// platform's own real escrow_amount/settlement_amount though, so that
// number is exact even when the itemized list is a simplified view of it.
// Shopee's get_escrow_detail has no real "payout date" field in the
// captured response, so its date column honestly shows when WE synced the
// row (order_settlements.synced_at), not a fabricated Shopee payout date.
// TikTok's statement_transactions DOES carry a real statement_time/status,
// used directly.
// Each fee line's `pct` (2026-08-19, new) is the real effective rate for
// THIS order — amount / merchandiseSubtotal — not a looked-up "official"
// %, since Shopee/TikTok don't publish a fixed per-fee-type rate and the
// real amounts already vary order to order. Computed after merchandise
// Subtotal is known, so it's added via a small helper below rather than
// inline in each fee list.
function withPct(fees, base) {
  return fees.map((f) => ({ ...f, pct: base > 0 ? (f.amount / base) * 100 : 0 }));
}

export function incomeBreakdown(o, settlement, t) {
  const raw = settlement.raw_response;
  if (settlement.platform === "shopee") {
    // deno-lint-ignore no-explicit-any
    const income = raw?.response?.order_income ?? {};
    const buyerInfo = raw?.response ?? {};
    const merchandiseSubtotal = Number(income.order_selling_price ?? 0);
    const fees = withPct(
      [
        { label: t("佣金", "Commission Fee"), amount: Number(settlement.shopee_commission_fee ?? 0) },
        { label: t("服务费", "Service Fee"), amount: Number(settlement.shopee_service_fee ?? 0) },
        { label: t("交易费", "Transaction Fee"), amount: Number(settlement.shopee_transaction_fee ?? 0) },
        { label: t("广告预扣费", "Ads Escrow Top-Up Fee"), amount: Number(settlement.shopee_ads_escrow_top_up_fee ?? 0) },
        // Shipping Seller Protection Fee (2026-08-20, new) — a real Shopee
        // fee field previously missing from our total entirely, confirmed
        // live against order 260819PQN51SEU (RM0.18 — without it, total
        // fees came in short of Shopee's own reported number).
        { label: t("运费保障费", "Shipping Seller Protection Fee"), amount: Number(settlement.shopee_shipping_seller_protection_fee ?? 0) },
        { label: t("AMS 联盟佣金", "AMS Commission Fee"), amount: Number(settlement.shopee_ams_commission_fee ?? 0) },
        { label: t("运费 SST", "Shipping Fee SST"), amount: Number(settlement.shopee_shipping_fee_sst ?? 0) },
      ].filter((f) => f.amount !== 0),
      merchandiseSubtotal,
    );
    // SPayLater installment period (2026-08-20, new) — real field
    // confirmed live (income.instalment_plan / tenure_info_list, values
    // like "3x"/"6x"/"12x") — formatted as "(N個月)" per explicit
    // request. Only meaningful when the real payment method is SPayLater.
    const installmentRaw = income.instalment_plan || income.tenure_info_list?.[0]?.instalment_plan || "";
    const installmentMonths = /^(\d+)x$/i.exec(String(installmentRaw).trim())?.[1];
    return {
      buyer: buyerInfo.buyer_user_name || "—",
      paymentMethod: buyerInfo.buyer_payment_info?.buyer_payment_method || "—",
      installmentLabel: installmentMonths ? t(`(${installmentMonths}個月)`, `(${installmentMonths}-Month)`) : "",
      // is_final distinguishes a real FINAL settlement (money actually
      // transferred) from a real but not-yet-final Shopee estimate on an
      // in-flight order — saying "打款成功" on the latter would be wrong,
      // the order hasn't been paid out yet. Non-final rows (both tabs)
      // now show a single unified label per explicit request, replacing
      // the old differentiated "Shopee 预估（未打款）"/"待结算" text —
      // final/paid rows keep their own real "打款成功" text since that's
      // factually accurate and unifying it would misrepresent money
      // that's already been transferred.
      statusLabel: settlement.is_final
        ? t("打款成功", "Payment Transferred Successfully")
        : t("等待订单完成", "Awaiting Order Completion"),
      statementDate: settlement.synced_at,
      statementDateIsRealPayoutDate: false,
      merchandiseSubtotal,
      shippingSubtotal: Number(income.buyer_paid_shipping_fee ?? 0) - Number(income.actual_shipping_fee ?? 0),
      // Split shipping (2026-08-20, new) — Shopee's real escrow response
      // carries both sides separately; exposed for the settlement detail
      // page's "买家支付运费 / 物流实扣运费" line items (Shopee official
      // bill style). null on TikTok, which only reports a net figure.
      buyerPaidShipping: Number(income.buyer_paid_shipping_fee ?? 0),
      logisticsShipping: Number(income.actual_shipping_fee ?? 0),
      fees,
      orderIncome: Number(settlement.shopee_escrow_amount ?? settlement.net_settlement ?? 0),
    };
  }
  // tiktok
  const txns = raw?.statement_transactions ?? [];
  const first = txns[0] ?? {};
  const merchandiseSubtotal = Number(first.net_sales_amount ?? 0);
  // Real settlement_amount (2026-08-21) — TikTok's own authoritative payout
  // number, independent of how we itemize fees below.
  const settlementAmount = Number(settlement.tiktok_settlement_amount ?? settlement.net_settlement ?? 0);
  // 达人佣金 (2026-08-22, user request) — kept separate from the other
  // named fees below and NEVER filtered out even at RM0.00, so the line is
  // always visible in the breakdown (confirms "checked, no affiliate
  // commission on this order" rather than silently omitting it the way a
  // zero-value fee normally would). Source field verified live 2026-08-22
  // against real order 585371986514117944: `affiliate_commission_amount`
  // inside statement_transactions/sku_statement_transactions, already read
  // by tiktok-settlement-sync into this exact column.
  const affiliateFee = { label: t("达人佣金", "Affiliate Commission"), amount: Number(settlement.tiktok_affiliate_commission ?? 0) };
  // Affiliate Shop Ads Commission (2026-08-22, new) — affiliate_ads_commission_amount
  // split back out into its own real column/line per explicit request,
  // separate from the organic+partner "达人佣金" line above. Real field,
  // already synced by tiktok-settlement-sync into tiktok_affiliate_ads_commission
  // (migration add_tiktok_affiliate_ads_commission) — filtered normally
  // (hidden at RM0, unlike the always-shown affiliateFee above, since no
  // "always visible" request was made for this specific line).
  const namedFees = [
    { label: t("平台佣金", "Platform Commission"), amount: Number(settlement.tiktok_commission_fee ?? 0) },
    { label: t("交易费", "Transaction Fee"), amount: Number(settlement.tiktok_transaction_fee ?? 0) },
    affiliateFee,
    { label: t("达人店铺广告佣金", "Affiliate Shop Ads Commission"), amount: Number(settlement.tiktok_affiliate_ads_commission ?? 0) },
    // 卖家承担运费 (2026-08-21, moved here from pagesOverviewOrders.jsx's
    // Order Drawer so both pages show it identically) — real, already-synced
    // tiktok_seller_shipping_fee column.
    { label: t("卖家承担运费", "Seller Shipping Fee"), amount: Number(settlement.tiktok_seller_shipping_fee ?? 0) },
  ].filter((f) => f === affiliateFee || f.amount !== 0);
  // Reconciliation catch-all (2026-08-21, moved here from pagesOverviewOrders.jsx
  // for the same reason) — TikTok's real raw_response `fee_amount` field is
  // its own authoritative total deduction, which can be larger than the sum
  // of the named fields we itemize above (e.g. real order 585582289461216754:
  // named fees summed to RM10.08, but merchandiseSubtotal - settlementAmount
  // = RM23.03 — the gap is real TikTok-side deductions with no individually
  // named/synced field, likely BXP/platform support fee per TikTok's own fee
  // schedule). Every number in this formula is already real synced data
  // (merchandiseSubtotal, each named fee, settlementAmount) — the residual is
  // derived, not guessed, so it only ever appears when positive and above a
  // 1-cent floating-point tolerance (never fabricated when the real numbers
  // already reconcile on their own).
  const namedFeesSum = +namedFees.reduce((sum, f) => sum + f.amount, 0).toFixed(2);
  const reconciliation = +(merchandiseSubtotal - namedFeesSum - settlementAmount).toFixed(2);
  const fees = withPct(
    reconciliation > 0.01
      ? [...namedFees, { label: t("其他平台费用 (BXP/支持费)", "Other Platform Fees (BXP / Support Fee)"), amount: reconciliation }]
      : namedFees,
    merchandiseSubtotal,
  );
  // Platform Discount bug fix (2026-08-21, live-verified against real order
  // 585582289461216754): tiktok_platform_discount was previously listed
  // inside `fees` (a deduction, rendered in red with a "-" prefix), but
  // TikTok's real raw_response shows this is money TikTok itself subsidizes
  // on the seller's behalf (a coupon/discount TikTok funds, not a cost the
  // seller pays) — real numbers confirm it: merchandiseSubtotal(143.55) -
  // commission(10.08) - platformDiscount(31.29) = 102.18, which is LESS
  // than the real orderIncome (120.52) — i.e. treating it as a deduction
  // made the math impossible to reconcile, the opposite of a subsidy's real
  // effect. Moved to a separate `credits` array (positive, green "+RM" in
  // FeeBreakdownPanel) instead of `fees`. Checked Shopee's incomeBreakdown
  // branch above for the same flaw — it has no discount-shaped field at
  // all, so this fix is TikTok-only, nothing shared to harmonize.
  const credits = [
    { label: t("平台折扣补贴", "Platform Discount Subsidy"), amount: Number(settlement.tiktok_platform_discount ?? 0) },
  ].filter((c) => c.amount !== 0);
  return {
    buyer: o.customer || "—",
    paymentMethod: o.isCod ? t("货到付款", "Cash on Delivery") : t("线上支付", "Online Payment"),
    installmentLabel: "",
    statusLabel: first.status === "SETTLED" ? t("已结算", "Settled") : (first.status || "—"),
    statementDate: first.statement_time ? new Date(Number(first.statement_time) * 1000).toISOString() : settlement.synced_at,
    statementDateIsRealPayoutDate: !!first.statement_time,
    merchandiseSubtotal,
    // Shipping is now itemized as a fee line above ("卖家承担运费", same
    // source field) instead of also shown as a separate net-shipping info
    // line here — avoids double-displaying the same real number.
    shippingSubtotal: 0,
    // TikTok's statement_transactions only reports a net shipping figure,
    // no buyer-paid/logistics-charged split — left null (not fabricated).
    buyerPaidShipping: null,
    logisticsShipping: null,
    fees,
    credits,
    orderIncome: settlementAmount,
  };
}

// Estimate-side mirror of incomeBreakdown (2026-08-19, new) — same return
// shape (merchandiseSubtotal/shippingSubtotal/fees[with pct]/orderIncome)
// so Pending rows can expand into the exact same panel format as Released,
// per explicit request ("格式必須跟已結算頁面一模一樣"). Every number here
// is still the formula estimate (FEE_RATE_PROFILE), not real platform
// data — pct is the configured rate itself, since no real deduction
// exists yet to derive an effective % from.
export function estimatedBreakdown(o, t) {
  const gross = o.unitPrice * o.qty;
  const rate = platformFeeRate(o.platform);
  const commissionAmt = +(gross * rate.commission).toFixed(2);
  const serviceAmt = +(gross * rate.service).toFixed(2);
  const transactionAmt = +(gross * rate.transaction).toFixed(2);
  return {
    merchandiseSubtotal: gross,
    shippingSubtotal: o.shippingFee,
    buyerPaidShipping: null,
    logisticsShipping: null,
    fees: [
      { label: t("佣金", "Commission Fee"), amount: commissionAmt, pct: rate.commission * 100 },
      { label: t("服务费", "Service Fee"), amount: serviceAmt, pct: rate.service * 100 },
      { label: t("交易费", "Transaction Fee"), amount: transactionAmt, pct: rate.transaction * 100 },
    ].filter((f) => f.amount !== 0),
    orderIncome: +(gross + o.shippingFee - commissionAmt - serviceAmt - transactionAmt).toFixed(2),
  };
}

// TikTok Shop MY commission is NOT a flat rate in reality — it varies by
// product category, Marketplace vs. Mall store type, and BXP participation.
// Neither `order` nor `order.items[]` currently carries a category or a
// real per-item commission rate (see mapDbOrder in shared.jsx — no
// `category`/`commissionRate` field is synced onto order_items today), so
// this map is NOT yet live-wired to any real order — a configurable
// placeholder, ready to be looked up by item.category the moment that field
// exists. **Rates sourced 2026-08-21 from TikTok Shop MY's published fee
// schedule via third-party seller-fee guides (Inseller, EZCON, TechNave —
// not TikTok's own dashboard, since no login is available in this
// environment) — treat as a good-faith estimate, not an authoritative
// number pulled directly from TikTok.**
const TIKTOK_CATEGORY_COMMISSION_RATES = {
  "电子/3C": 0.0702,
  "时尚/日用百货": 0.0837,
  "食品饮料": 0.1026,
};
// Default changed 0.0837 -> 0.0702 (2026-08-22, user-confirmed) — reverse-
// solved against real order 585636172703433891 (unsettled, user compared
// against TikTok Seller Center's own estimate): with transaction(3.78%)
// and platform support(flat RM0.54) fixed and known-correct, and BXP
// applied at 4.86%, the only commission rate that makes
// commission+transaction+BXP+support sum to TikTok's real stated RM19.01
// total (on RM118 revenue) is exactly 7.02% — matches to the cent. Treated
// as this store's real effective rate for motorcycle/automotive parts
// (this store's actual catalog), not a general TikTok-wide claim.
const DEFAULT_TIKTOK_COMMISSION_RATE = 0.0702;

// Real per-order-value fee components sourced the same way/date as the
// commission map above (Inseller/EZCON/TechNave, 2026-08-21) — not pulled
// from TikTok's own dashboard directly:
// - Transaction Fee: 3.78% of order value (SST-inclusive per source).
// - BXP (Bonus Cashback / Voucher Xtra service fee): ~4.86%, only actually
//   charged to sellers enrolled in TikTok's Bonus Extra Programme. No
//   per-store BXP-enrollment flag exists in this codebase yet, so this is
//   applied by default (matches the common case) — set to 0 below if a
//   given store is confirmed NOT enrolled.
// - Platform Support Fee: a FLAT RM0.50 + 8% SST = RM0.54 per successfully
//   delivered order (not a %, doesn't scale with order value), effective
//   2026-02-15 per TikTok's own Seller University page.
const TIKTOK_TRANSACTION_FEE_RATE = 0.0378;
const TIKTOK_BXP_RATE = 0.0486;
const TIKTOK_PLATFORM_SUPPORT_FEE_FLAT = 0.54;

// Resolves the commission rate for one order item, in priority order:
// (1) an explicit per-item rate if the order API ever supplies one,
// (2) a category lookup in TIKTOK_CATEGORY_COMMISSION_RATES if the item
// carries a category, (3) the flat default. Today every real item falls
// through to (3) since neither (1) nor (2)'s source fields exist yet — this
// function is the single place to update once they do.
function resolveTikTokCommissionRate(item) {
  if (item.commissionRate != null) return Number(item.commissionRate);
  if (item.category && TIKTOK_CATEGORY_COMMISSION_RATES[item.category] != null) {
    return TIKTOK_CATEGORY_COMMISSION_RATES[item.category];
  }
  return DEFAULT_TIKTOK_COMMISSION_RATE;
}

// Affiliate commission ONLY ever appears here if the order/item actually
// carries real creator-attribution data — never a guessed default rate
// (self-sold orders are legitimately 0, and a flat fake % would misstate
// them). Checks, in order: (1) an explicit per-item amount, (2) a per-item
// rate combined with the order-level isAffiliateOrder flag, (3) falls
// through to 0 with no fee line at all. None of these fields exist in
// mapDbOrder (shared.jsx) or order_items today — this only activates once a
// real TikTok affiliate/creator sync is built; until then every order
// correctly computes to exactly 0 here.
function resolveTikTokAffiliateCommission(o, lineItems) {
  return +lineItems
    .reduce((sum, it) => {
      if (it.affiliateCommission != null) return sum + Number(it.affiliateCommission);
      if (o.isAffiliateOrder && it.affiliateRate != null) return sum + it.unitPrice * it.qty * Number(it.affiliateRate);
      return sum;
    }, 0)
    .toFixed(2);
}

// BXP now applies by default for every TikTok estimate (2026-08-22,
// user-confirmed — was previously gated behind a non-existent
// `o.isBxpParticipant` flag and always computed to 0). Reverse-solved
// against real order 585636172703433891 (see DEFAULT_TIKTOK_COMMISSION_RATE
// above for the full derivation): TikTok's real stated estimate for this
// store only reconciles to the cent when BXP is included at 4.86% — the
// user confirmed this store is an active BXP participant. `o.isBxpParticipant`
// still short-circuits to 0 if a future real per-store flag is wired up and
// explicitly set false, so this isn't a dead code path.
function resolveTikTokBxpFee(o, revenue) {
  if (o.isBxpParticipant === false) return 0;
  return +(revenue * TIKTOK_BXP_RATE).toFixed(2);
}

// TikTok-only pre-settlement ESTIMATE, mirrors TikTok Seller Center's real
// "Order Settlement" breakdown structure. Moved here 2026-08-21 (was
// previously a local copy inside pagesOverviewOrders.jsx's Order Drawer) so
// the Finance page and Order Drawer use the exact same estimate formula —
// they had silently diverged (Order Drawer using these sourced rates,
// Finance page still calling the older flat-5% estimatedBreakdown() above
// for TikTok orders), producing two different "Estimated Payout" numbers
// for the same unsettled order. Now both pages call this one function for
// TikTok; `estimatedBreakdown()` above is used for Shopee only.
//
// Est. Revenue = subtotal after seller discounts; no per-order seller-
// discount field is tracked yet, so this is simply gross, summed across
// every real order item. Commission/Transaction Fee/Platform Support Fee
// are TikTok's real standard per-order rates (not optional programmes) —
// always computed. BXP and Affiliate Commission are OPTIONAL programme
// fees and only ever compute to a non-zero amount when the order payload
// explicitly confirms participation — both correctly resolve to 0 on every
// real (still-unsettled) order today, no fallback guess rate. Total =
// Est. Revenue - sum of Est. Fees; zero-amount lines drop out automatically.
export function tiktokEstimatedBreakdown(o, t, affiliateEstimate, affiliateAdsEstimate) {
  const lineItems = o.items && o.items.length > 0 ? o.items : [{ unitPrice: o.unitPrice, qty: o.qty, originalPrice: o.originalPrice, sellerDiscount: o.sellerDiscount }];
  // Est. Revenue base (2026-08-24, user-confirmed fix; revised 2026-08-26
  // once a second real order exposed the missing half of the formula).
  // TikTok's own real pre-settlement estimate uses original_price MINUS
  // seller_discount only — NOT original_price alone, and NOT sale_price.
  // sale_price nets out BOTH platform_discount (TikTok-funded, not a real
  // cost to the seller — deliberately not subtracted here) AND
  // seller_discount (seller-funded, a genuine real cost — this IS
  // subtracted). Live-verified against two real orders with opposite
  // discount compositions: 585688274303748056 (seller_discount=0,
  // platform_discount=13.80 → revenue = original_price exactly, RM138) and
  // 585732518380734339 (seller_discount=7.25, platform_discount=0 → revenue
  // = 145-7.25 = RM137.75, and every downstream fee — commission RM9.67,
  // transaction RM5.21, BXP RM6.69, support RM0.54, affiliate RM2.76,
  // payout RM112.88 — matches TikTok's real settlement preview to the
  // cent). `it.originalPrice`/`it.sellerDiscount` are the real synced
  // fields (order_items.original_price/seller_discount, tiktok-sync-orders);
  // falls back to unitPrice*qty for rows synced before original_price
  // existed (originalPrice will be 0 on those) so nothing breaks for
  // not-yet-resynced orders — sellerDiscount defaults to 0 either way,
  // which is always a safe "no seller discount" default, never "unknown".
  const itemRevenue = (it) => (it.originalPrice > 0 ? it.originalPrice - (it.sellerDiscount || 0) : it.unitPrice * it.qty);
  const revenue = +lineItems.reduce((sum, it) => sum + itemRevenue(it), 0).toFixed(2);
  const commissionAmt = +lineItems
    .reduce((sum, it) => sum + itemRevenue(it) * resolveTikTokCommissionRate(it), 0)
    .toFixed(2);
  // Transaction fee base (2026-08-24, user-confirmed fix, live-verified
  // against real order 585682879558485805): TikTok charges this fee on what
  // the buyer actually paid in total, not just merchandise value — real
  // order: revenue RM35.80 + buyer shipping RM3.60 = RM39.40, ×3.78% =
  // RM1.49 (exactly matches TikTok's real Est. Fees; our old revenue-only
  // base gave RM1.35, RM0.14 short). Re-checked against the earlier
  // reference order 585688274303748056 too: buyer shipping was RM0 there,
  // so revenue+0 still gives the same RM5.22 already verified — this change
  // doesn't regress that order. `o.shippingFee` is the real buyer-paid
  // shipping (orders.shipping_fee, synced from TikTok's payment.shipping_fee).
  const transactionAmt = +((revenue + (o.shippingFee || 0)) * TIKTOK_TRANSACTION_FEE_RATE).toFixed(2);
  const bxpAmt = resolveTikTokBxpFee(o, revenue);
  const platformSupportAmt = TIKTOK_PLATFORM_SUPPORT_FEE_FLAT;
  // Est. Seller Shipping Fee (2026-08-22, user-confirmed fix, live-verified
  // against real order 585653516133893588's TikTok Seller Center estimate):
  // TikTok's real logic nets Actual Shipping Fee (courier's real cost)
  // against Customer Shipping Fee (what the buyer paid) — net lands at RM0
  // whenever the buyer fully covers shipping, e.g. that real order: Actual
  // -RM1.60, Customer +RM1.60, net RM0. We previously subtracted
  // `order.shippingFee` directly as a cost — but that field only ever holds
  // what the BUYER paid (synced from payment.shipping_fee), not the
  // courier's actual cost, and pre-settlement we have no real
  // actual-courier-cost field to net it against. Subtracting the buyer-paid
  // amount as if it were a seller cost double-counts money the buyer
  // already covered. Set to 0 here (real settled orders already compute
  // this correctly via incomeBreakdown()'s tiktok_seller_shipping_fee, a
  // genuinely netted real column, unaffected by this change).
  const shippingAmt = 0;
  // Real per-order estimate (2026-08-26) from tiktok_affiliate_commissions,
  // passed in by the caller — preferred over resolveTikTokAffiliateCommission
  // (which only ever computes non-zero once o.isAffiliateOrder/item-level
  // fields are populated elsewhere, which they never are today). Three
  // states from the caller: a real number (order found in the synced
  // table, could legitimately be RM0.00 on one SKU row), the sentinel
  // string "organic" (caller confirmed the affiliate sync is current AND
  // this order has no row — i.e. genuinely no creator involved, not just
  // "not synced yet"), or undefined (unknown / not looked up — old
  // disclaimer behavior, unchanged for any caller that doesn't pass this).
  const affiliateAmt = typeof affiliateEstimate === "number"
    ? +affiliateEstimate.toFixed(2)
    : Number(resolveTikTokAffiliateCommission(o, lineItems));
  // Affiliate Shop Ads Commission (2026-08-26, new) — a distinct real fee
  // from the organic/partner commission line above, itemized separately by
  // TikTok's own settlement preview (live-verified against real order
  // 585731533702923353: TikTok shows -RM1.75 on this exact line, and this
  // order's real tiktok_affiliate_commissions.estimated_paid_shop_ads_commission
  // is 1.75 — combined with the other real fees below, revenue RM38.80 -
  // commission RM2.72 - transaction RM1.53 - BXP RM1.89 - support RM0.54 -
  // ads RM1.75 = total fees RM8.43, payout RM30.37 — matches TikTok's real
  // numbers on this order exactly). Caller passes a plain number (0 when
  // absent) — no "not synced" disclaimer needed for this one since it's a
  // simple additive fee line, not the thing affiliateNote below is about.
  const affiliateAdsAmt = typeof affiliateAdsEstimate === "number" ? +affiliateAdsEstimate.toFixed(2) : 0;
  const fees = [
    { label: t("TikTok 平台佣金", "TikTok Shop Commission Fee"), amount: commissionAmt, pct: revenue > 0 ? (commissionAmt / revenue) * 100 : 0 },
    // pct here is the effective rate vs merchandise revenue (matches how
    // every other fee line's pct is computed just above/below) — now that
    // transactionAmt's base includes buyer shipping too, showing the flat
    // TIKTOK_TRANSACTION_FEE_RATE here would understate the displayed %
    // relative to the actual RM amount shown next to it.
    { label: t("预估交易费", "Est. Transaction Fee"), amount: transactionAmt, pct: revenue > 0 ? (transactionAmt / revenue) * 100 : 0 },
    { label: t("红利返现/超级福袋服务费 (BXP)", "Bonus Cashback / Voucher Xtra Service Fee (BXP)"), amount: bxpAmt, pct: revenue > 0 ? (bxpAmt / revenue) * 100 : 0 },
    { label: t("平台支持费", "Platform Support Fee"), amount: platformSupportAmt, pct: revenue > 0 ? (platformSupportAmt / revenue) * 100 : 0 },
    { label: t("预估卖家运费", "Est. Seller Shipping Fee"), amount: shippingAmt, pct: revenue > 0 ? (shippingAmt / revenue) * 100 : 0 },
    { label: t("预估达人佣金", "Est. Affiliate Commission"), amount: affiliateAmt, pct: revenue > 0 ? (affiliateAmt / revenue) * 100 : 0 },
    { label: t("达人/商城广告佣金 (Affiliate Shop Ads Commission)", "Affiliate Shop Ads Commission"), amount: affiliateAdsAmt, pct: revenue > 0 ? (affiliateAdsAmt / revenue) * 100 : 0 },
  ].filter((f) => f.amount !== 0);
  const totalFees = +fees.reduce((sum, f) => sum + f.amount, 0).toFixed(2);
  // Affiliate commission placeholder note (2026-08-22, user request; revised
  // 2026-08-26) — originally always shown because the Affiliate Seller API
  // was confirmed 105005-blocked (Custom Apps couldn't access it). That's no
  // longer true: KSG's 2026-08-25 reauth added the required
  // seller.affiliate_collaboration.read scope, live-verified working, and
  // tiktok_affiliate_commissions now holds real per-order-SKU data (synced
  // every 5 min by tiktok-sync-orders' syncAffiliateCommissions action). The
  // note now only appears when affiliateEstimate is genuinely absent (order
  // not yet picked up by that sync, or a shop that hasn't reauthorized) —
  // once a real value (including a real RM0.00) is known, it's shown as the
  // "预估达人佣金" fee line above instead of this disclaimer. Real settled
  // orders still overwrite everything with incomeBreakdown()'s authoritative
  // settlement.tiktok_affiliate_commission and never show this note.
  const affiliateNote = typeof affiliateEstimate === "number"
    ? null
    : affiliateEstimate === "organic"
      ? t("本单无达人带货佣金", "This order has no affiliate/creator commission")
      : t(
          "达人佣金以 TikTok 官方结算数据为准，本单尚未同步到达人佣金数据（未计入以上预估到账金额，不代表本单无达人佣金）",
          "Affiliate commission reflects TikTok's official settlement once available — this order hasn't been synced with affiliate commission data yet (not included in the estimated payout above; does not mean this order has zero affiliate commission)",
        );
  return {
    merchandiseSubtotal: revenue,
    // Shipping is now represented as a fee line (deduction) above, matching
    // TikTok's real settlement structure — not shown again as a separate
    // net-shipping info line here, to avoid double-displaying the same number.
    shippingSubtotal: 0,
    buyerPaidShipping: null,
    logisticsShipping: null,
    fees,
    affiliateNote,
    orderIncome: +(revenue - totalFees).toFixed(2),
  };
}

// Picks the correct pre-settlement estimate function per platform — TikTok
// gets the real-rate-sourced tiktokEstimatedBreakdown() above, everything
// else (Shopee) keeps using the flat-rate estimatedBreakdown(). Single
// switch point so Finance page and Order Drawer can never diverge on which
// function they call for a given platform again.
export function estimateBreakdownForPlatform(o, t, affiliateEstimate, affiliateAdsEstimate) {
  return o.platform === "TikTok Shop" ? tiktokEstimatedBreakdown(o, t, affiliateEstimate, affiliateAdsEstimate) : estimatedBreakdown(o, t);
}

// Shared expand-panel renderer (2026-08-19, new; isEstimate added 2026-08-20)
// — used identically by the Pending, Released, and "待已结算" (compare)
// tabs so the breakdown format is guaranteed pixel-for-pixel consistent
// everywhere it appears, per explicit request. `detail` is either a real
// incomeBreakdown() or an estimatedBreakdown() result — both share the
// same shape. `isEstimate` only swaps labels/wording (never the numbers)
// so an estimated payout is never visually mistaken for a real one, and
// "预估平台费" (the deduction) is never mistaken for "预估到账金额" (the
// result after deduction) — the exact confusion flagged in the request.
export function FeeBreakdownPanel({ detail, t, isEstimate, items }) {
  // Split shipping (2026-08-20, new) — Shopee's real escrow response
  // separates "买家支付运费" (income into escrow) from "物流实扣运费"
  // (Shopee's actual delivery cost, a deduction) — shown as two distinct
  // official-bill-style line items when both are available (real Shopee
  // orders). Falls back to a single net "运费" line for TikTok (no split
  // in its real data) and for estimated/Pending rows (nothing to split).
  const hasSplitShipping = detail.buyerPaidShipping != null && detail.logisticsShipping != null;
  return (
    <>
      {/* Full item list (2026-08-20, bug fix) — previously this panel only
          ever showed the aggregate 商品总额 number, with no way to see
          which/how-many products made it up; multi-item orders (e.g.
          260818MXYTPJ36, 2 real items) looked like they only had one
          product anywhere in the UI. Loops over the order's real, full
          `items` array (already fetched from order_items — see
          mapDbOrder in shared.jsx — just never rendered here before),
          not just the single highest-subtotal "first" item other parts
          of the app use. */}
      {items && items.length > 0 && (
        <div className="space-y-2 mb-3 pb-3 border-b border-slate-200">
          {items.map((it, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs">
              {it.image ? (
                <img src={it.image} alt={it.productName} className="h-10 w-10 rounded-md object-cover border border-slate-200 shrink-0" />
              ) : (
                <div className="h-10 w-10 rounded-md bg-slate-100 border border-slate-200 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-slate-700 truncate">{it.productName}</div>
                <div className="text-slate-400 truncate">{[it.sku, it.variation].filter(Boolean).join(" · ") || "—"}</div>
              </div>
              <div className="text-right shrink-0 text-slate-500 tabular-nums">
                RM {fmt(it.unitPrice)} × {it.qty}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
        <div>
          <div className="text-slate-400 mb-1">{t("商品总额", "Merchandise Subtotal")}</div>
          <div className="font-medium tabular-nums">RM {fmt(detail.merchandiseSubtotal)}</div>
        </div>
        {hasSplitShipping ? (
          <>
            <div>
              <div className="text-slate-400 mb-1">{t("买家支付运费", "Shipping Paid by Buyer")}</div>
              <div className="font-medium tabular-nums">RM {fmt(detail.buyerPaidShipping)}</div>
            </div>
            <div>
              <div className="text-slate-400 mb-1">{t("物流实扣运费", "Shipping Charged by Logistics")}</div>
              <div className="font-medium tabular-nums text-rose-600">- RM {fmt(detail.logisticsShipping)}</div>
            </div>
          </>
        ) : (
          <div>
            <div className="text-slate-400 mb-1">{t("运费", "Shipping")}</div>
            <div className="font-medium tabular-nums">RM {fmt(detail.shippingSubtotal)}</div>
          </div>
        )}
        <div>
          <div className="text-slate-400 mb-1">{isEstimate ? t("预估到账金额", "Est. Payout Amount") : t("最终到账金额", "Order Income")}</div>
          <div className={`font-bold tabular-nums text-base ${isEstimate ? "italic text-slate-500" : "text-emerald-600"}`}>RM {fmt(detail.orderIncome)}</div>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-slate-200">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-slate-400">{isEstimate ? t("预估平台费 (Estimated Fees & Charges)", "Estimated Fees & Charges") : t("费用扣除明细", "Fees & Charges")}</div>
          {/* 扣费总额 (2026-08-24, new) — sum of every line below, shown
              inline next to the title so staff don't have to add up each
              row by hand. Derived from detail.fees (already the real
              synced/estimated numbers rendered below), never a separate
              fabricated figure. */}
          {detail.fees.length > 0 && (
            <div className="font-medium tabular-nums text-blue-600">
              (RM {fmt(detail.fees.reduce((sum, f) => sum + f.amount, 0))})
            </div>
          )}
        </div>
        {detail.fees.length === 0 ? (
          <div className="text-slate-300">{t("此单无额外扣费", "No additional fees on this order")}</div>
        ) : (
          <div className="space-y-1">
            {detail.fees.map((f) => (
              <div key={f.label} className="flex items-center justify-between text-slate-600">
                <span>{f.label} ({f.pct.toFixed(2)}%)</span>
                <span className="tabular-nums text-rose-600">- RM {fmt(f.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Credits (2026-08-21, new) — platform-funded subsidies/reimbursements
          (e.g. TikTok's real platform_discount) that ADD to what the seller
          keeps, shown separately from `fees` so they're never mistaken for a
          cost. Optional field, empty/absent on every other detail shape
          (Shopee, estimates) — nothing renders here for those. */}
      {detail.credits && detail.credits.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-200">
          <div className="text-slate-400 mb-1.5">{t("平台补贴", "Platform Credits")}</div>
          <div className="space-y-1">
            {detail.credits.map((c) => (
              <div key={c.label} className="flex items-center justify-between text-slate-600">
                <span>{c.label}</span>
                <span className="tabular-nums text-emerald-600">+ RM {fmt(c.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {isEstimate && (
        <div className="mt-3 pt-3 border-t border-dashed border-slate-200 text-[11px] text-slate-400">
          {t(
            "公式：商品总额 + 运费小计 − 预估平台费 = 预估到账金额（尚无真实结算数据，实际到账以平台结算为准，与上方"
              + "「预估平台费」是两个不同的数字）",
            'Formula: Merchandise Subtotal + Shipping Subtotal − Estimated Fees = Estimated Payout Amount (no real settlement yet — actual payout is set by the platform; this is a different number from "Estimated Fees" above)',
          )}
        </div>
      )}
      {/* Affiliate commission placeholder note (2026-08-22, new) — see
          tiktokEstimatedBreakdown()'s affiliateNote comment for the full
          rationale. Only ever set on the TikTok pre-settlement estimate
          shape; absent/undefined everywhere else, so this renders nowhere
          else. Styled as an info note (amber), not a red fee line, since
          it's not a numeric deduction. */}
      {detail.affiliateNote && (
        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-2">
          <Info size={12} className="shrink-0 mt-0.5" />
          <span>{detail.affiliateNote}</span>
        </div>
      )}
    </>
  );
}

// Order Settlement Detail drawer (2026-08-20, new) — replaces the old
// inline accordion per explicit request ("不再仅限于列表内部手风琴展开").
// Opens as a right-side slide-over when an order number is clicked from
// any of the three tabs (Pending/Released/账单异常), reusing
// FeeBreakdownPanel for the itemized breakdown so the numbers stay
// identical to what was shown inline before — only the presentation
// (dedicated panel vs. in-row expansion) changed. When the order is a
// flagged anomaly, a red alert box with an 预估 vs 实际 comparison table
// sits above the breakdown, per explicit request ("在詳情頁頂部用醒目提
// 示框顯示").
function SettlementDetailDrawer({ order, finance, detail, t, onClose }) {
  const isReal = finance.isReal;
  const isRealEstimate = finance.isRealEstimate;
  const hasRealData = isReal || isRealEstimate;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="bg-white w-full max-w-md h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between z-10">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{order.id}</div>
            <div className="text-[11px] text-slate-400 truncate">{(hasRealData && detail.buyer) || order.customer} · {order.platform}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none shrink-0 ml-2">×</button>
        </div>
        <div className="p-5 space-y-4">
          {isRealEstimate && (
            <div className="text-xs bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 text-sky-700">
              {t("该订单尚未打款，以下为 Shopee 官方预估数字（真实 API 数据，非固定比例公式），最终以平台实际结算为准", "This order hasn't been paid out yet — figures below are Shopee's own real estimate (real API data, not a flat-rate formula); the final settlement may adjust slightly")}
            </div>
          )}
          {!hasRealData && (
            <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-500">
              {t("该订单尚未收到平台真实结算账单，以下金额为系统预估（公式计算）", "This order has no real settlement data yet — figures below are a system estimate (formula-calculated)")}
            </div>
          )}
          {isReal && (
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{detail.statusLabel}</span>
              <span>{new Date(detail.statementDate).toLocaleDateString()}</span>
            </div>
          )}
          {isReal && finance.isAnomaly && (
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-rose-700 mb-2">
                ⚠ {t("费用异常：预估与实际扣费不一致", "Fee Anomaly: Estimated and actual deductions don't match")}
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-rose-400">
                    <th className="text-left font-medium py-1">{t("项目", "Item")}</th>
                    <th className="text-right font-medium py-1">{t("预估", "Est.")}</th>
                    <th className="text-right font-medium py-1">{t("实际", "Actual")}</th>
                    <th className="text-right font-medium py-1">{t("差额", "Diff")}</th>
                  </tr>
                </thead>
                <tbody className="text-rose-700">
                  <tr>
                    <td className="py-1">{t("平台费用", "Platform Fees")}</td>
                    <td className="text-right py-1 tabular-nums">RM {finance.estFees.toFixed(2)}</td>
                    <td className="text-right py-1 tabular-nums">RM {finance.fees.toFixed(2)}</td>
                    <td className="text-right py-1 tabular-nums font-semibold">RM {finance.feeDiff.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <FeeBreakdownPanel detail={detail} t={t} isEstimate={!isReal} items={order.items} />
        </div>
      </div>
    </div>
  );
}

export function Finance({ t, orders, stores }) {
  // Platform/store filtering (2026-08-18, new) — same activePlatform/
  // activeStore pattern Order Management Center uses (pagesOverviewOrders.jsx):
  // activeStore === null means "该平台全部店铺". Reusing the exact same
  // state shape/semantics rather than inventing a new filtering concept.
  const [activePlatform, setActivePlatform] = useState("Shopee");
  const [activeStore, setActiveStore] = useState(null);
  const platformTheme = PLATFORM_THEME[activePlatform];
  const platformStores = (stores || []).filter((s) => s.platform === activePlatform);
  const platformAccountIds = new Set(platformStores.map((s) => s.id));

  // Date filter (2026-08-18, new) — Today / Past 7 Days / Past 30 Days /
  // Custom Range, same option shape as Order Management Center's date
  // filter (pagesOverviewOrders.jsx's DATE_FILTER_OPTIONS) but defined
  // locally here rather than imported, so this page's filter state stays
  // fully independent — selecting a range here can never affect Order
  // Management Center's own date filter or vice versa. Declared before
  // scopedOrders (below) since its filter callback calls inDateRange
  // synchronously on every render — dateMode etc. must already be
  // initialized by then.
  // Date filter options (2026-08-20, reworded per explicit request to
  // mirror Shopee's own "我的进账" page: 本周/本月/过去三个月/选择日期
  // instead of the previous 今天/7天/30天/自定义). Values renamed to
  // match ("week"/"month"/"3m"/"custom") — inDateRange's logic below is
  // the only place that reads them, so this is a self-contained rename.
  const [dateMode, setDateMode] = useState("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  function inDateRange(o) {
    const d = o.date;
    if (!d) return true;
    const now = new Date();
    if (dateMode === "week") {
      // Start of this week (Monday), per Shopee's own "本周" convention.
      const day = now.getDay(); // 0=Sun..6=Sat
      const diffToMonday = (day + 6) % 7;
      const monday = new Date(now); monday.setDate(now.getDate() - diffToMonday);
      return d >= monday.toISOString().slice(0, 10);
    }
    if (dateMode === "month") {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return d >= firstOfMonth.toISOString().slice(0, 10);
    }
    if (dateMode === "3m") return d >= new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    if (dateMode === "custom") {
      if (customStart && d < customStart) return false;
      if (customEnd && d > customEnd) return false;
      return true;
    }
    return true;
  }

  const scopedOrders = orders.filter((o) =>
    o.platform === activePlatform
    && o.status !== "已取消"
    && platformAccountIds.has(o.platformAccountId)
    && (!activeStore || o.platformAccountId === activeStore)
    && inDateRange(o),
  );

  // Real settlement data (2026-08-18) — order_settlements is populated by
  // shopee-settlement-sync / tiktok-settlement-sync (real get_escrow_detail /
  // GET .../statement_transactions data, verified live against real orders
  // 260808S41FFFRT and 582623995474379880). Fetched per active platform, not
  // scoped to activeStore, since switching stores shouldn't refetch. Orders
  // with no row here yet (not COMPLETED, or not synced) fall back to the
  // estimatedFees/estimatedProfit placeholder below — never silently blended
  // together, every render below picks one or the other per order. Selects
  // `*` (not just total_fees/net_settlement) because the Income Details
  // accordion below (2026-08-18, new) needs the individual real fee columns
  // + raw_response to build its breakdown.
  const [settlements, setSettlements] = useState({}); // order_no -> row
  useEffect(() => {
    let cancelled = false;
    supabaseClient
      .from("order_settlements")
      .select("*")
      .eq("platform", DEMO_TO_DB_PLATFORM[activePlatform])
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.error("order_settlements fetch failed", error); return; }
        const byOrderNo = {};
        (data || []).forEach((r) => { byOrderNo[r.order_no] = r; });
        setSettlements(byOrderNo);
      });
    return () => { cancelled = true; };
  }, [activePlatform]);

  // 达人佣金预估 (2026-08-26, new) — real per-order-SKU data from
  // tiktok_affiliate_commissions (tiktok-sync-orders' syncAffiliateCommissions
  // action, live-verified against the real Affiliate Seller API — see that
  // table's migration comment). Summed here per order_no (an order can carry
  // multiple SKUs, each with its own creator/commission row) so
  // tiktokEstimatedBreakdown() below can show a real pre-settlement number
  // instead of the old "not obtainable due to API access limits" placeholder
  // note. TikTok-only table, so this only ever fetches on the TikTok tab.
  // Settled orders are NOT affected by this — incomeBreakdown() above already
  // uses the separate, authoritative settlement.tiktok_affiliate_commission
  // column (from tiktok-settlement-sync); this estimate is only ever read for
  // orders with no settlement row yet, so historical/settled revenue numbers
  // can't be distorted by a pre-settlement estimate changing later.
  const [affiliateEstimates, setAffiliateEstimates] = useState({}); // order_no -> summed estimated_paid_commission
  // Affiliate Shop Ads Commission (2026-08-26, new) — a distinct real fee
  // from the organic/partner commission above (see tiktokEstimatedBreakdown's
  // own comment for the full real-order verification), summed separately
  // per order_no since a row can carry a real ads-commission value with a
  // null estimated_paid_commission (exactly real order 585731533702923353).
  const [affiliateAdsEstimates, setAffiliateAdsEstimates] = useState({});
  useEffect(() => {
    if (activePlatform !== "TikTok Shop") { setAffiliateEstimates({}); setAffiliateAdsEstimates({}); return; }
    let cancelled = false;
    supabaseClient
      .from("tiktok_affiliate_commissions")
      .select("order_no, estimated_paid_commission, estimated_paid_shop_ads_commission")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.error("tiktok_affiliate_commissions fetch failed", error); return; }
        const byOrderNo = {};
        const adsByOrderNo = {};
        (data || []).forEach((r) => {
          if (r.estimated_paid_commission != null) {
            byOrderNo[r.order_no] = (byOrderNo[r.order_no] || 0) + Number(r.estimated_paid_commission);
          }
          if (r.estimated_paid_shop_ads_commission != null) {
            adsByOrderNo[r.order_no] = (adsByOrderNo[r.order_no] || 0) + Number(r.estimated_paid_shop_ads_commission);
          }
        });
        setAffiliateEstimates(byOrderNo);
        setAffiliateAdsEstimates(adsByOrderNo);
      });
    return () => { cancelled = true; };
  }, [activePlatform]);

  // Order Settlement Detail drawer (2026-08-20) — clicking the order
  // number opens the full drawer. Coexists with the inline accordion
  // below (2026-08-20, restored per explicit request to mirror Shopee's
  // own "我的进账" page, which expands in place via a ∨ chevron) — both
  // interactions stay available side by side, per explicit choice.
  const [detailOrderId, setDetailOrderId] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());
  function toggleExpand(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Pending/Released/Compare tab (2026-08-18, updated 2026-08-19) — three
  // parallel pills in one row, per explicit request ("[待結算][已結算]
  // [待已結算]" side by side). "compare" replaces what used to be a
  // separate "financeView" state/button — merged into this single tab
  // state so all three are literally one tab group, not a tab bar plus a
  // separate button. Defaults to "released" so the expandable, real-data
  // rows are what's visible on first load.
  const [incomeTab, setIncomeTab] = useState("released");

  // Pagination (2026-08-20, new) — per explicit request to mirror Shopee's
  // own "我的进账" page (page-number nav + page-size dropdown), since a
  // real store can have hundreds of orders in one tab. Shared across all
  // four tabs; reset-to-page-1 effect is declared further below, after
  // incomeSearchQuery exists (it's one of the reset triggers).
  const [incomePage, setIncomePage] = useState(1);
  const [incomePageSize, setIncomePageSize] = useState(20);

  // Income Details search box (2026-08-19, new; upgraded 2026-08-20 to a
  // field-scoped dropdown+input, mirroring Order Management Center's own
  // searchField/q pattern — pagesOverviewOrders.jsx — per explicit request
  // ("参照订单列表的搜索组件"). Same field→column mapping precedent as that
  // component (sellerSku/package reuse sku/tracking since there's no
  // separate synced column for either — not fabricating new fields).
  // Three states: which field to search, the live input value, and the
  // committed query that actually filters — only updates on Enter or
  // clicking the search icon, per explicit request, not live-as-you-type.
  const [incomeSearchField, setIncomeSearchField] = useState("orderNo");
  const [incomeSearchInput, setIncomeSearchInput] = useState("");
  const [incomeSearchQuery, setIncomeSearchQuery] = useState("");
  useEffect(() => {
    setIncomePage(1);
  }, [incomeTab, incomeSearchQuery, dateMode, customStart, customEnd, activePlatform, activeStore]);
  // Live suggestion dropdown (2026-08-20, new) — open while the input is
  // focused and non-empty, per explicit request ("参考 Shopee 实时搜索体
  // 验"). Separate from incomeSearchQuery (the committed, Enter/icon-
  // triggered filter for the tab lists below) so typing alone never
  // narrows the tables — only opens the dropdown.
  const [incomeSearchFocused, setIncomeSearchFocused] = useState(false);
  function incomeSearchFieldValue(o) {
    return (
      incomeSearchField === "orderNo" ? o.id :
      incomeSearchField === "sku" ? o.sku :
      incomeSearchField === "product" ? o.product :
      incomeSearchField === "variation" ? o.variation :
      incomeSearchField === "sellerSku" ? o.sku :
      incomeSearchField === "tracking" ? o.tracking :
      incomeSearchField === "package" ? o.tracking :
      incomeSearchField === "customer" ? o.customer :
      incomeSearchField === "note" ? o.noteText : o.id
    ) || "";
  }
  function runIncomeSearch() {
    setIncomeSearchQuery(incomeSearchInput.trim());
    setIncomeSearchFocused(false);
  }
  function matchesIncomeSearch(o) {
    const q = incomeSearchQuery.trim().toLowerCase();
    if (!q) return true;
    return incomeSearchFieldValue(o).toLowerCase().includes(q);
  }

  // Per-order real-vs-estimated resolver — real settlement wins when synced,
  // otherwise falls back to the fixed-rate estimate (still clearly marked
  // "*预估" in the UI below). Once real, also carries the formula estimate
  // alongside it (estFees/feeDiff/isAnomaly, 2026-08-19) purely so the
  // "待已结算" compare page below can filter down to mismatches — not
  // rendered inline on the main row/table per explicit request.
  function orderFinance(o) {
    const real = settlements[o.id];
    if (real && real.is_final) {
      const fees = Number(real.total_fees) || 0;
      // Anomaly baseline (2026-08-20, upgraded) — ONLY compares against
      // Shopee's own real pre-settlement estimate (captured while the
      // order was still in-flight, preserved by shopee-settlement-sync
      // into estimated_total_fees before this row got overwritten with
      // final numbers). Real-vs-real is the only comparison confident
      // enough to act on — the old flat-rate formula never modeled
      // per-order fee mix (ads/AMS/shipping-protection all vary order to
      // order) and produced a confirmed-live near-100% false-positive
      // rate. Per explicit request ("嚴禁將所有訂單全量塞入賬單異常列
      // 表"), an order with NO real baseline (completed before this
      // tracking existed — currently ~1352/1355 of historical orders)
      // is simply not checkable and is never flagged, rather than falling
      // back to the unreliable formula. Coverage grows automatically as
      // orders complete going forward (shopee-pending-estimate-sync now
      // captures a baseline for every in-flight order).
      const hasRealBaseline = real.estimated_total_fees != null;
      const estFees = hasRealBaseline ? Number(real.estimated_total_fees) || 0 : null;
      // Fees-only comparison (2026-08-20, corrected) — deliberately does
      // NOT fold in the real shipping shortfall (buyer-paid vs logistics-
      // charged shipping) the way an earlier version of this check did.
      // Verified live this session: that shortfall is present on nearly
      // every real order (routine Shopee shipping-rebate/protection
      // mechanics, e.g. shopee_shipping_seller_protection_fee applies
      // broadly) — folding it into the trigger reproduced the same
      // near-100% false-positive problem this whole fix exists to solve,
      // even after switching to a real baseline. total_fees vs
      // estimated_total_fees (both real Shopee numbers, same field,
      // before vs after) is the one comparison confirmed live to actually
      // agree when nothing went wrong (3/3 real examples matched exactly).
      const feeDiff = hasRealBaseline ? +(fees - estFees).toFixed(2) : null;
      return {
        isReal: true,
        fees,
        netProfit: (Number(real.net_settlement) || 0) - o.cost * o.qty,
        estFees,
        hasRealBaseline,
        realDeduction: fees,
        feeDiff,
        isAnomaly: hasRealBaseline && Math.abs(feeDiff) > FEE_ANOMALY_THRESHOLD,
      };
    }
    if (real && !real.is_final) {
      // Real Shopee pre-settlement estimate (2026-08-20, new) — order
      // hasn't been paid out yet (still "待结算"), but the numbers come
      // straight from Shopee's own get_escrow_detail response instead of
      // the flat-rate formula, per explicit request ("請勿使用固定8%比例
      // 硬算...改用...官方預估字段"). isReal stays false so this order
      // correctly stays out of 已结算/账单异常 until it actually settles.
      return {
        isReal: false,
        isRealEstimate: true,
        fees: Number(real.total_fees) || 0,
        netProfit: (Number(real.net_settlement) || 0) - o.cost * o.qty,
      };
    }
    const { platformFee, commission } = estimatedFees(o);
    return { isReal: false, fees: platformFee + commission, netProfit: estimatedProfit(o) };
  }

  // "账单异常 / 待核对" tab (2026-08-19, renamed 2026-08-20 per explicit
  // request from "待已结算") — only real-settled orders whose actual
  // deducted amount (fees + any real shipping shortfall) disagrees with
  // the formula estimate by more than FEE_ANOMALY_THRESHOLD; matching
  // orders pass silently and stay in the normal Released list, exactly as
  // specified ("金額完全一致...靜默通過...無需特殊標記或轉移"). Computed
  // once here so both the tab's count badge and its content use the exact
  // same list. Also honors the search box so the count/list narrows along
  // with Pending/Released.
  const mismatchedOrders = scopedOrders.filter((o) => {
    const f = orderFinance(o);
    return f.isReal && f.isAnomaly && matchesIncomeSearch(o);
  });

  // Current tab's full (unpaginated) row list — computed once so the tab
  // pill counts, the pagination footer, and the table body all agree.
  const currentTabOrders = incomeTab === "compare" ? mismatchedOrders : scopedOrders.filter((o) => {
    if (!matchesIncomeSearch(o)) return false;
    const isReal = orderFinance(o).isReal;
    if (incomeTab === "released") return isReal;
    if (incomeTab === "waiting") return !isReal && !o.lastPrintedAt;
    if (incomeTab === "pending") return !isReal && !!o.lastPrintedAt;
    return false;
  });
  // Pagination (2026-08-20, new) — page-number nav + page-size dropdown,
  // per explicit request to mirror Shopee's own "我的进账" page.
  const incomeTotalPages = Math.max(1, Math.ceil(currentTabOrders.length / incomePageSize));
  const incomePageSafe = Math.min(incomePage, incomeTotalPages);
  const pagedIncomeOrders = currentTabOrders.slice((incomePageSafe - 1) * incomePageSize, incomePageSafe * incomePageSize);

  // Live suggestion dropdown (2026-08-20, new) — top 6 matches for the
  // in-progress (uncommitted) search input, per explicit request
  // ("参考 Shopee 实时搜索体验"). Only shown while the input is focused
  // and non-empty; separate from incomeSearchQuery so typing alone never
  // narrows the tab tables, only clicking a suggestion opens that order's
  // detail drawer directly.
  const liveSearchMatches = (incomeSearchFocused && incomeSearchInput.trim())
    ? scopedOrders.filter((o) => incomeSearchFieldValue(o).toLowerCase().includes(incomeSearchInput.trim().toLowerCase())).slice(0, 6)
    : [];

  const byStore = platformStores.map((s) => {
    const os = scopedOrders.filter((o) => o.platformAccountId === s.id);
    const revenue = os.reduce((sum, o) => sum + o.unitPrice * o.qty, 0);
    const fees = os.reduce((sum, o) => sum + orderFinance(o).fees, 0);
    const cost = os.reduce((sum, o) => sum + o.cost * o.qty, 0);
    const netProfit = os.reduce((sum, o) => sum + orderFinance(o).netProfit, 0);
    const realCount = os.filter((o) => orderFinance(o).isReal).length;
    return { storeId: s.id, store: s.name, revenue, fees, cost, netProfit, realCount, totalCount: os.length };
  });

  const totalRevenue = scopedOrders.reduce((s, o) => s + o.unitPrice * o.qty, 0);
  const totalFees = scopedOrders.reduce((s, o) => s + orderFinance(o).fees, 0);
  const totalProfit = scopedOrders.reduce((s, o) => s + orderFinance(o).netProfit, 0);
  const realSettledCount = scopedOrders.filter((o) => orderFinance(o).isReal).length;

  return (
    <div className="space-y-6">
      {/* Platform tabs — same look/behavior as AdsSpend's platform switcher
          further down this file. Switching platform resets activeStore
          (a store id from the old platform would never match anyway). */}
      <div className="inline-flex bg-white border border-slate-200 rounded-xl p-1 gap-1">
        {["Shopee", "TikTok Shop"].map((pf) => {
          const pfTheme = PLATFORM_THEME[pf];
          const active = activePlatform === pf;
          return (
            <button
              key={pf}
              onClick={() => { setActivePlatform(pf); setActiveStore(null); }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active ? `${pfTheme.headerBg} text-white` : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${active ? "bg-white/80" : pfTheme.dot}`} />
              {pf}
            </button>
          );
        })}
      </div>

      {/* Store selector — same "全部店铺" + per-store button row Order
          Management Center uses. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setActiveStore(null)}
          className={`text-xs px-3 py-2 rounded-lg border ${
            activeStore === null ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          }`}
        >
          {t("全部店铺", "All Stores")}
        </button>
        {platformStores.map((s) => {
          const isActive = activeStore === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setActiveStore(s.id)}
              className={`text-xs px-3 py-2 rounded-lg border ${
                isActive ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              {s.name}
            </button>
          );
        })}
        {platformStores.length === 0 && (
          <span className="text-xs text-slate-400">{t("尚未连接任何店铺", "No stores connected yet")}</span>
        )}
      </div>

      {/* Date filter (2026-08-18, new) — Today/Past 7 Days/Past 30 Days/
          Custom Range. Feeds straight into scopedOrders above, so every KPI
          card / chart / table on this page narrows together automatically. */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={dateMode}
          onChange={(e) => setDateMode(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg outline-none text-slate-600 px-2.5 py-2 bg-white"
        >
          <option value="week">{t("本周", "This Week")}</option>
          <option value="month">{t("本月", "This Month")}</option>
          <option value="3m">{t("过去三个月", "Past 3 Months")}</option>
          <option value="custom">{t("选择日期", "Select Date")}</option>
        </select>
        {dateMode === "custom" && (
          <>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg outline-none text-slate-600 px-2.5 py-2 bg-white"
            />
            <span className="text-xs text-slate-400">{t("至", "to")}</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg outline-none text-slate-600 px-2.5 py-2 bg-white"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICardImpl label={t("总营收 (RM)", "Total Revenue (RM)")} value={fmt(totalRevenue)} icon={TrendingUp} tone="bg-teal-500" />
        <KPICardImpl
          label={realSettledCount === scopedOrders.length && scopedOrders.length > 0 ? t("平台费用+佣金 (RM)", "Platform Fees + Commission (RM)") : t("平台费用+佣金 (RM) *部分预估", "Platform Fees + Commission (RM) *Partly Est.")}
          value={realSettledCount === scopedOrders.length && scopedOrders.length > 0
            ? fmt(totalFees)
            : <span className="italic text-slate-400" title={EST_FEE_TOOLTIP}>{fmt(totalFees)}</span>}
          sub={t(`真实结算 ${realSettledCount}/${scopedOrders.length} 笔，其余为预估`, `${realSettledCount}/${scopedOrders.length} orders use real settlement data, rest estimated`)}
          icon={DollarSign}
          tone="bg-amber-500"
        />
        <KPICardImpl
          label={realSettledCount === scopedOrders.length && scopedOrders.length > 0 ? t("净利润 (RM)", "Net Profit (RM)") : t("净利润 (RM) *部分预估", "Net Profit (RM) *Partly Est.")}
          value={realSettledCount === scopedOrders.length && scopedOrders.length > 0
            ? fmt(totalProfit)
            : <span className="italic text-slate-400" title={EST_FEE_TOOLTIP}>{fmt(totalProfit)}</span>}
          sub={realSettledCount === scopedOrders.length && scopedOrders.length > 0
            ? t("已用平台真实结算数据", "Uses real platform settlement data")
            : t("*部分为预估费用，非最终数字", "*Partly estimated, not final")}
          icon={TrendingUp}
          tone={platformTheme.headerBg}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-sm font-medium mb-3">{t(`${activePlatform} 按店铺利润拆分`, `${activePlatform} Profit Breakdown by Store`)}</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byStore}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="store" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="revenue" name={t("营收", "Revenue")} fill="#0ea5a4" radius={[4, 4, 0, 0]} />
                <Bar dataKey="fees" name={t("费用+佣金", "Fees + Commission")} fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="netProfit" name={t("净利润", "Net Profit")} fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Legend />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-sm font-medium mb-3">{t("店铺明细", "Store Detail")}</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                <th className="py-2 font-medium">{t("店铺", "Store")}</th>
                <th className="py-2 font-medium text-right">{t("营收", "Revenue")}</th>
                <th className="py-2 font-medium text-right">{t("成本", "Cost")}</th>
                <th className="py-2 font-medium text-right">{t("净利润", "Net Profit")}</th>
                <th className="py-2 font-medium text-right">{t("真实结算", "Real Data")}</th>
              </tr>
            </thead>
            <tbody>
              {byStore.map((s) => {
                const allReal = s.realCount === s.totalCount && s.totalCount > 0;
                return (
                  <tr key={s.storeId} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5">{s.store}</td>
                    <td className="py-2.5 text-right tabular-nums">{fmt(s.revenue)}</td>
                    <td className="py-2.5 text-right tabular-nums">{fmt(s.cost)}</td>
                    <td className={`py-2.5 text-right tabular-nums font-medium ${allReal ? "text-emerald-600" : "italic text-slate-400"}`} title={allReal ? undefined : EST_FEE_TOOLTIP}>
                      {fmt(s.netProfit)}
                    </td>
                    <td className="py-2.5 text-right text-[11px] text-slate-400 tabular-nums">{s.realCount}/{s.totalCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order-level Income Details accordion (2026-08-18, restructured to
          mirror Shopee Seller Centre's Income Details interaction; updated
          2026-08-19 to a single 3-way tab group [待結算][已結算][待已結算]
          per explicit request, with Pending/Compare rows now expandable
          into the exact same FeeBreakdownPanel format as Released). */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-sm font-medium mb-3">{t("订单收支明细", "Order Income Details")}</div>
        {/* Three parallel pills — [待結算][已結算][账单异常] side by side,
            per explicit request (previously "待已结算" was a separate
            top-right button; now one tab group) — plus a field-scoped
            search box on the right of the same row, mirroring Order
            Management Center's own searchField/q dropdown+input pattern
            (2026-08-20, upgraded from a single free-text box per explicit
            request "参照订单列表的搜索组件"). Only filters on Enter or
            clicking the search icon, not live-as-you-type. */}
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="inline-flex bg-slate-100 rounded-lg p-1 gap-1">
            {[
              { key: "waiting", label: t("等结算", "Awaiting Ship"), count: scopedOrders.filter((o) => !orderFinance(o).isReal && !o.lastPrintedAt && matchesIncomeSearch(o)).length },
              { key: "pending", label: t("待结算", "Pending"), count: scopedOrders.filter((o) => !orderFinance(o).isReal && !!o.lastPrintedAt && matchesIncomeSearch(o)).length },
              { key: "released", label: t("已结算", "Released"), count: scopedOrders.filter((o) => orderFinance(o).isReal && matchesIncomeSearch(o)).length },
              { key: "compare", label: t("账单异常", "Billing Anomaly"), count: mismatchedOrders.length },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setIncomeTab(tab.key)}
                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                  incomeTab === tab.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {/* Field dropdown — same 9 options/mapping as Order Management
                Center's searchField (pagesOverviewOrders.jsx), per explicit
                request ("参照订单列表的搜索组件"). */}
            <select
              value={incomeSearchField}
              onChange={(e) => setIncomeSearchField(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg outline-none text-slate-600 px-2 py-1.5 bg-white shrink-0"
            >
              <option value="orderNo">{t("订单号", "Order No.")}</option>
              <option value="sku">{t("店铺SKU", "Store SKU")}</option>
              <option value="product">{t("产品名称", "Product Name")}</option>
              <option value="variation">{t("商品 Variation", "Variation")}</option>
              <option value="sellerSku">{t("Seller SKU", "Seller SKU")}</option>
              <option value="tracking">{t("运单号", "Tracking No.")}</option>
              <option value="package">{t("包裹号", "Package No.")}</option>
              <option value="customer">{t("买家名称", "Buyer Name")}</option>
              <option value="note">{t("备注", "Note")}</option>
            </select>
            <div className="relative">
              <input
                type="text"
                value={incomeSearchInput}
                onChange={(e) => setIncomeSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runIncomeSearch(); }}
                onFocus={() => setIncomeSearchFocused(true)}
                onBlur={() => setTimeout(() => setIncomeSearchFocused(false), 150)}
                placeholder={t("输入关键词搜索", "Enter a keyword")}
                className="text-xs border border-slate-200 rounded-lg pl-3 pr-8 py-1.5 w-48 focus:outline-none focus:ring-1 focus:ring-slate-300"
              />
              <button
                onClick={runIncomeSearch}
                title={t("搜索", "Search")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <Search size={13} />
              </button>
              {/* Live suggestion dropdown (2026-08-20, new) — top 6 matches,
                  Shopee-style: thumbnail + red order number + buyer name,
                  per explicit request. Clicking opens the detail drawer
                  directly, bypassing tab commitment. */}
              {liveSearchMatches.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 overflow-hidden w-72">
                  {liveSearchMatches.map((o) => (
                    <button
                      key={o.id}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setDetailOrderId(o.id);
                        setIncomeSearchFocused(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-left border-b border-slate-100 last:border-0"
                    >
                      {o.productImage ? (
                        <img src={o.productImage} alt={o.product} className="h-8 w-8 rounded-md object-cover border border-slate-200 shrink-0" />
                      ) : (
                        <div className="h-8 w-8 rounded-md bg-slate-100 border border-slate-200 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-rose-600 truncate">{o.id}</div>
                        <div className="text-[11px] text-slate-400 truncate">{o.customer}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {incomeSearchQuery && (
              <button
                onClick={() => { setIncomeSearchInput(""); setIncomeSearchQuery(""); }}
                className="text-xs px-2 py-1.5 rounded-lg text-slate-400 hover:text-slate-600"
                title={t("清除搜索", "Clear search")}
              >
                ×
              </button>
            )}
          </div>
        </div>
        <div className="text-xs text-slate-400 mb-3">
          {incomeTab === "released" && t("点击订单号查看独立结算详情页，或点击 ∨ 在列表内展开明细（真实结算数据）", "Click the order number for its full settlement detail page, or ∨ to expand the breakdown inline (real settlement data)")}
          {incomeTab === "waiting" && t("这些订单还未在 ERP 打印面单；蓝色标记为 Shopee 官方真实预估，灰色为系统公式预估", "These orders haven't had their shipping label printed in the ERP yet; blue rows use Shopee's own real estimate, gray rows use a system formula estimate")}
          {incomeTab === "pending" && t("这些订单已打印面单，还没有打款；蓝色标记为 Shopee 官方真实预估，灰色为系统公式预估", "These orders have had their label printed but haven't been paid out yet; blue rows use Shopee's own real estimate, gray rows use a system formula estimate")}
          {incomeTab === "compare" && t(
            `系统自动比对 Shopee 打单前的真实预估费用与结算后的真实扣费，仅显示差额超过 RM ${FEE_ANOMALY_THRESHOLD.toFixed(2)} 的异常订单（无真实预估基准的历史订单不参与比对，不会被误判）；金额一致的订单已自动隐藏、正常归入已结算列表`,
            `System auto-compares Shopee's real pre-settlement estimate against the real final deduction — only orders differing by more than RM ${FEE_ANOMALY_THRESHOLD.toFixed(2)} are shown here (historical orders with no real baseline are skipped, never guessed at); matching orders pass silently into the Released list`,
          )}
        </div>
        <div className="overflow-x-auto">
        {incomeTab !== "compare" ? (
        <table className="w-full text-sm min-w-[680px]">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
              <th className="py-2 pr-3 font-medium">{t("订单", "Order")}</th>
              <th className="py-2 pr-3 font-medium">{incomeTab === "released" ? t("拨款时间", "Payout Time") : t("结算/同步日期", "Statement Date")}</th>
              <th className="py-2 pr-3 font-medium">{t("状态", "Status")}</th>
              <th className="py-2 pr-3 font-medium">{t("支付方式", "Payment Method")}</th>
              {incomeTab !== "released" && <th className="py-2 pr-3 font-medium">{t("预估平台费", "Est. Platform Fee")}</th>}
              <th className="py-2 pr-3 font-medium text-right">{incomeTab !== "released" ? t("预估到账金额", "Est. Payout Amount") : t("到账金额", "Released Amount")}</th>
            </tr>
          </thead>
          <tbody>
            {pagedIncomeOrders.map((o) => {
              const finance = orderFinance(o);
              const { isReal, isRealEstimate } = finance;
              // hasRealData (2026-08-20) — true for both a final settlement
              // AND a real (not-yet-final) Shopee estimate, so both use the
              // real incomeBreakdown() instead of the flat formula. Only
              // orders with genuinely no Shopee data at all (not yet
              // synced, or TikTok) fall back to estimatedBreakdown().
              const hasRealData = isReal || isRealEstimate;
              const real = settlements[o.id];
              const detail = hasRealData ? incomeBreakdown(o, real, t) : estimateBreakdownForPlatform(o, t, affiliateEstimates[o.id], affiliateAdsEstimates[o.id]);
              const rate = platformFeeRate(o.platform);
              // Row-summary total (2026-08-21) — derived from `detail.fees`
              // (the same estimateBreakdownForPlatform() result the expanded
              // row below renders) instead of the separate finance.fees/
              // rate.total from orderFinance()/estimatedFees(), which still
              // used the old flat 5% TikTok rate — that mismatch was
              // exactly the "two different numbers for the same order" bug
              // reported live (Order Drawer RM30.65 vs Finance RM33.02).
              // Only affects this collapsed-row display; orderFinance()'s
              // own net-profit/anomaly-detection math is untouched.
              const estTotalFees = !hasRealData ? +detail.fees.reduce((sum, f) => sum + f.amount, 0).toFixed(2) : finance.fees;
              const estTotalPct = !hasRealData && detail.merchandiseSubtotal > 0 ? (estTotalFees / detail.merchandiseSubtotal) * 100 : rate.total * 100;
              const expanded = expandedIds.has(o.id);
              return (
                <Fragment key={o.id}>
                <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      {o.productImage ? (
                        <img src={o.productImage} alt={o.product} className="h-9 w-9 rounded-lg object-cover border border-slate-200 shrink-0" />
                      ) : (
                        <div className="h-9 w-9 rounded-lg bg-slate-100 border border-slate-200 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); setDetailOrderId(o.id); }}
                          className="font-medium truncate text-teal-600 hover:underline block"
                        >
                          {o.id}
                        </button>
                        <div className="text-[11px] text-slate-400 truncate">{(hasRealData && detail.buyer) || o.customer}</div>
                        {(o.sku || o.variation) && (
                          <div className="text-[10px] text-slate-300 truncate">{[o.sku, o.variation].filter(Boolean).join(" · ")}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-slate-500">
                    {hasRealData ? new Date(detail.statementDate).toLocaleDateString() : "—"}
                    {hasRealData && !detail.statementDateIsRealPayoutDate && (
                      <span className="ml-1 text-slate-300" title={t("Shopee 真实数据无实际拨款日期字段，此为同步时间", "Shopee's real API has no payout-date field; this is our sync time")}>*</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-xs">
                    {isReal ? (
                      <span className="text-emerald-600">{detail.statusLabel}</span>
                    ) : isRealEstimate ? (
                      <span className="text-sky-600">{detail.statusLabel}</span>
                    ) : (
                      <span className="text-slate-400">{t("等待订单完成", "Awaiting Order Completion")}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-slate-500">
                    {hasRealData ? detail.paymentMethod : "—"}
                    {hasRealData && detail.installmentLabel && (
                      <div className="text-[10px] text-slate-400">{detail.installmentLabel}</div>
                    )}
                  </td>
                  {incomeTab !== "released" && (
                    <td className="py-2.5 pr-3 text-xs text-slate-500">
                      {isRealEstimate
                        ? t(`Shopee 预估 RM ${finance.fees.toFixed(2)}`, `Shopee Est. RM ${finance.fees.toFixed(2)}`)
                        : t(`系统预估 (${estTotalPct.toFixed(2)}%) RM ${estTotalFees.toFixed(2)}`, `System Est. (${estTotalPct.toFixed(2)}%) RM ${estTotalFees.toFixed(2)}`)}
                    </td>
                  )}
                  <td className="py-2.5 pr-3 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleExpand(o.id); }}
                      className="flex items-center justify-end gap-1.5 w-full"
                      title={t("展开明细", "Expand breakdown")}
                    >
                      <span
                        className={`tabular-nums font-medium ${isReal ? "text-emerald-600" : isRealEstimate ? "text-sky-600" : "italic text-slate-400"}`}
                        title={isReal ? undefined : isRealEstimate ? t(
                          "Shopee 官方预估到账金额（真实 API 数据，订单尚未打款，金额可能在结算前微调）",
                          "Shopee's own estimated payout amount (real API data — order not yet paid out, figure may shift slightly before final settlement)",
                        ) : t(
                          "预估到账金额，按标准费率算出（商品总额+运费小计−预估平台费），并非平台真实结算数字",
                          "Estimated payout amount, calculated from the standard rate (Merchandise + Shipping − Estimated Fees) — not a real platform settlement figure",
                        )}
                      >
                        RM {fmt(detail.orderIncome)}
                      </span>
                      <ChevronDown size={14} className={`text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-b border-slate-100 last:border-0">
                    <td colSpan={incomeTab !== "released" ? 6 : 5} className="bg-slate-50 px-4 py-4">
                      <FeeBreakdownPanel detail={detail} t={t} isEstimate={!isReal} items={o.items} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        ) : mismatchedOrders.length === 0 ? (
          <div className="text-sm text-slate-400 py-8 text-center">{t("目前没有发现金额不一致的订单", "No mismatched orders found")}</div>
        ) : (
        <table className="w-full text-sm min-w-[600px]">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
              <th className="py-2 pr-3 font-medium">{t("订单", "Order")}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("预估扣除金额", "Estimated Deduction")}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("实际扣除金额", "Actual Deduction")}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("差额", "Diff")}</th>
            </tr>
          </thead>
          <tbody>
            {pagedIncomeOrders.map((o) => {
              const finance = orderFinance(o);
              const rate = platformFeeRate(o.platform);
              const real = settlements[o.id];
              const detail = incomeBreakdown(o, real, t);
              const expanded = expandedIds.has(o.id);
              return (
                <Fragment key={o.id}>
                <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      {o.productImage ? (
                        <img src={o.productImage} alt={o.product} className="h-9 w-9 rounded-lg object-cover border border-slate-200 shrink-0" />
                      ) : (
                        <div className="h-9 w-9 rounded-lg bg-slate-100 border border-slate-200 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); setDetailOrderId(o.id); }}
                          className="font-medium truncate text-teal-600 hover:underline block"
                        >
                          {o.id}
                        </button>
                        <div className="text-[11px] text-slate-400 truncate">{detail.buyer || o.customer}</div>
                        {(o.sku || o.variation) && (
                          <div className="text-[10px] text-slate-300 truncate">{[o.sku, o.variation].filter(Boolean).join(" · ")}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-500">
                    ({(rate.total * 100).toFixed(2)}%) RM {finance.estFees.toFixed(2)}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700 font-medium">RM {finance.realDeduction.toFixed(2)}</td>
                  <td className="py-2.5 pr-3 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleExpand(o.id); }}
                      className="flex items-center justify-end gap-1.5 w-full"
                      title={t("展开明细", "Expand breakdown")}
                    >
                      <span className="tabular-nums text-rose-600 font-semibold">RM {finance.feeDiff.toFixed(2)}</span>
                      <ChevronDown size={14} className={`text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-b border-slate-100 last:border-0">
                    <td colSpan={4} className="bg-slate-50 px-4 py-4">
                      <FeeBreakdownPanel detail={detail} t={t} items={o.items} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        )}
        </div>
        {/* Pagination footer (2026-08-20, new) — page-number nav + page-size
            dropdown, per explicit request to mirror Shopee's own "我的进账"
            page. Shared across all four tabs (currentTabOrders/pagedIncome
            Orders already point at whichever tab is active). */}
        {currentTabOrders.length > 0 && (
          <div className="flex items-center justify-between flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
            <div className="text-xs text-slate-400">
              {t(`共 ${currentTabOrders.length} 笔`, `${currentTabOrders.length} total`)}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIncomePage((p) => Math.max(1, p - 1))}
                  disabled={incomePageSafe <= 1}
                  className="px-2 py-1 text-xs rounded-md border border-slate-200 text-slate-500 disabled:opacity-30 hover:bg-slate-50"
                >
                  ‹
                </button>
                {(() => {
                  const pages = [];
                  const total = incomeTotalPages;
                  const cur = incomePageSafe;
                  const add = (n) => pages.push(n);
                  add(1);
                  if (cur - 1 > 2) pages.push("…l");
                  for (let n = Math.max(2, cur - 1); n <= Math.min(total - 1, cur + 1); n++) add(n);
                  if (cur + 1 < total - 1) pages.push("…r");
                  if (total > 1) add(total);
                  return pages.map((p, idx) =>
                    typeof p === "number" ? (
                      <button
                        key={p}
                        onClick={() => setIncomePage(p)}
                        className={`px-2.5 py-1 text-xs rounded-md ${p === cur ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50 border border-slate-200"}`}
                      >
                        {p}
                      </button>
                    ) : (
                      <span key={p + idx} className="px-1 text-xs text-slate-300">…</span>
                    )
                  );
                })()}
                <button
                  onClick={() => setIncomePage((p) => Math.min(incomeTotalPages, p + 1))}
                  disabled={incomePageSafe >= incomeTotalPages}
                  className="px-2 py-1 text-xs rounded-md border border-slate-200 text-slate-500 disabled:opacity-30 hover:bg-slate-50"
                >
                  ›
                </button>
              </div>
              <select
                value={incomePageSize}
                onChange={(e) => { setIncomePageSize(Number(e.target.value)); setIncomePage(1); }}
                className="text-xs border border-slate-200 rounded-lg outline-none text-slate-600 px-2 py-1 bg-white"
              >
                <option value={10}>10 {t("条/页", "/ page")}</option>
                <option value={20}>20 {t("条/页", "/ page")}</option>
                <option value={50}>50 {t("条/页", "/ page")}</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Order Settlement Detail drawer (2026-08-20, new) — see
          SettlementDetailDrawer above. Looked up from scopedOrders so it
          works no matter which of the three tabs the click came from. */}
      {detailOrderId && (() => {
        const o = scopedOrders.find((ord) => ord.id === detailOrderId);
        if (!o) return null;
        const finance = orderFinance(o);
        const real = settlements[o.id];
        const detail = (finance.isReal || finance.isRealEstimate) ? incomeBreakdown(o, real, t) : estimateBreakdownForPlatform(o, t, affiliateEstimates[o.id], affiliateAdsEstimates[o.id]);
        return (
          <SettlementDetailDrawer
            order={o}
            finance={finance}
            detail={detail}
            t={t}
            onClose={() => setDetailOrderId(null)}
          />
        );
      })()}
    </div>
  );
}

/* ============================== AI panel ============================== */

function restockSuggestions(inventory) {
  return inventory.map((item) => {
    const total = item.warehouseA + item.warehouseB;
    const dailySales = 2 + (item.sku.length % 4);
    const daysLeft = Math.max(1, Math.round(total / dailySales));
    const suggestedQty = Math.max(0, item.reorderPoint * 2 - total);
    return { ...item, total, daysLeft, suggestedQty };
  }).filter((i) => i.total < i.reorderPoint + 15).sort((a, b) => a.daysLeft - b.daysLeft);
}

const FAQ_RULES = [
  { keys: ["追踪", "物流", "到哪"], reply: "您的包裹正在配送中，可在【订单管理中心】输入订单编号查看实时物流状态与追踪号码。" },
  { keys: ["退款", "退货"], reply: "退款申请提交后 3-5 个工作日内处理，商品需保持未拆封状态。您可在订单详情页发起退款申请。" },
  { keys: ["尺码", "size"], reply: "本店 M 码适合 55-65kg，L 码适合 65-75kg，如介于两者之间建议选大一码。" },
  { keys: ["优惠", "折扣", "coupon"], reply: "关注店铺可获取新客优惠券，大促期间另有满减活动，请留意店铺公告。" },
];
function aiReply(text) {
  const hit = FAQ_RULES.find((r) => r.keys.some((k) => text.includes(k)));
  return hit ? hit.reply : "已收到您的问题，AI 客服正在为您查找答案，如未能解决将在 10 分钟内转接人工客服。";
}

// Per-shop Seller (sender) info used on shipping labels — auto-selected per
// order by platformAccountId in PrintSlip/labelFields; this panel is where
// an owner maintains the source values per connected store. Customer/
// recipient info is never editable here or anywhere in print — it's always
// read straight from the order (see labelFields / ShippingLabelCard).
function SellerSettingsPanel({ t, stores, onUpdateSellerInfo }) {
  const [drafts, setDrafts] = useState({});

  function draftFor(store) {
    return drafts[store.id] || { name: store.sellerName || "", address: store.sellerAddress || "", phone: store.sellerPhone || "" };
  }
  function setDraftField(storeId, key, value) {
    setDrafts((prev) => ({ ...prev, [storeId]: { ...draftFor({ id: storeId, ...prev[storeId] }), [key]: value } }));
  }
  function save(store) {
    const d = draftFor(store);
    onUpdateSellerInfo?.(store.id, d);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-sm font-medium flex items-center gap-1.5"><Settings size={14} className="text-slate-500" /> {t("Seller 资料（店铺管理）", "Seller Info (Store Management)")}</div>
      <div className="text-xs text-slate-400 mt-1 mb-3">
        {t("每个店铺各自维护一份发货单 Seller 资料，打印时按订单来源店铺自动选用，不再手动填写或写死。", "Each store keeps its own shipping-label Seller info. Printing auto-selects it by the order's originating store instead of manual entry or a hardcoded name.")}
      </div>
      {(!stores || stores.length === 0) && <div className="text-xs text-slate-400">{t("尚未连接任何店铺", "No stores connected yet")}</div>}
      <div className="space-y-3">
        {(stores || []).map((store) => {
          const d = draftFor(store);
          return (
            <div key={store.id} className="border border-slate-200 rounded-lg p-3">
              <div className="text-xs font-medium text-slate-600 mb-2">{store.platform} · {store.name}</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] text-slate-400 mb-1 block">{t("Seller / 店铺名称", "Seller / Shop Name")}</label>
                  <input
                    value={d.name}
                    onChange={(e) => setDraftField(store.id, "name", e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-slate-400"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 mb-1 block">{t("Seller 电话", "Seller Phone")}</label>
                  <input
                    value={d.phone}
                    onChange={(e) => setDraftField(store.id, "phone", e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-slate-400"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 mb-1 block">{t("Seller 地址", "Seller Address")}</label>
                  <input
                    value={d.address}
                    onChange={(e) => setDraftField(store.id, "address", e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-slate-400"
                  />
                </div>
              </div>
              <button
                onClick={() => save(store)}
                className="mt-2 text-[11px] px-2.5 py-1 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
              >
                {t("保存", "Save")}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Optional fields the admin can choose to show/hide per template — customer/
// recipient fields are intentionally absent from both lists: they're always
// rendered and never editable (see ShippingLabelCard's Recipient block),
// not something print can be configured to omit.
const SHIPPING_TOGGLABLE_FIELDS = [
  { key: "shipByDate", zh: "发货日期", en: "Ship By Date" },
  { key: "weight", zh: "重量", en: "Weight" },
  { key: "senderName", zh: "寄件人 Seller 名称", en: "Sender / Seller Name" },
  { key: "senderPhone", zh: "寄件人电话", en: "Sender Phone" },
  { key: "senderAddress", zh: "寄件地址", en: "Sender Address" },
  { key: "postcode", zh: "邮编", en: "Postcode" },
  { key: "image", zh: "产品图片", en: "Product Photo" },
  { key: "sku", zh: "SKU", en: "SKU" },
  { key: "note", zh: "备注", en: "Note" },
];
const PICKING_TOGGLABLE_FIELDS = [
  { key: "image", zh: "产品图片", en: "Product Photo" },
  { key: "sku", zh: "SKU", en: "SKU" },
  { key: "productName", zh: "产品名称", en: "Product Name" },
  { key: "qty", zh: "数量 Qty", en: "Qty" },
];

// Which fields print on each template, and in what order — both persisted
// in label_template_settings.enabled_fields as a single ordered array
// (Postgres arrays keep element order, so array position IS print order;
// no separate "sort index" column needed). Admin drags rows to reorder the
// enabled set; re-adding a removed field appends it to the end.
function TemplateFieldSettingsPanel({ t }) {
  const [settings, setSettings] = useState(null); // null = loading
  const dragKeyRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    supabaseClient
      .from("label_template_settings")
      .select("template_type, enabled_fields")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) { setSettings({ shipping: [], picking: [] }); return; }
        const byType = {};
        data.forEach((row) => { byType[row.template_type] = row.enabled_fields || []; });
        setSettings({ shipping: byType.shipping || [], picking: byType.picking || [] });
      });
    return () => { cancelled = true; };
  }, []);

  function save(templateType, nextOrder) {
    setSettings((prev) => ({ ...prev, [templateType]: nextOrder }));
    supabaseClient
      .from("label_template_settings")
      .update({ enabled_fields: nextOrder, updated_at: new Date().toISOString() })
      .eq("template_type", templateType)
      .then(({ error }) => error && console.error("TemplateFieldSettingsPanel save failed", error));
  }

  function remove(templateType, key) {
    const current = settings[templateType];
    save(templateType, current.filter((k) => k !== key));
  }

  function add(templateType, key) {
    const current = settings[templateType];
    if (current.includes(key)) return;
    save(templateType, [...current, key]);
  }

  function reorder(templateType, draggedKey, targetKey) {
    if (draggedKey === targetKey) return;
    const current = [...settings[templateType]];
    const from = current.indexOf(draggedKey);
    const to = current.indexOf(targetKey);
    if (from === -1 || to === -1) return;
    current.splice(from, 1);
    current.splice(to, 0, draggedKey);
    save(templateType, current);
  }

  function renderChecklist(templateType, fieldDefs, title) {
    const order = settings?.[templateType] || [];
    const orderSet = new Set(order);
    const enabledDefs = order.map((key) => fieldDefs.find((f) => f.key === key)).filter(Boolean);
    const disabledDefs = fieldDefs.filter((f) => !orderSet.has(f.key));

    return (
      <div className="border border-slate-200 rounded-lg p-3">
        <div className="text-xs font-medium text-slate-600 mb-2">{title}</div>

        <div className="text-[11px] text-slate-400 mb-1">{t("已启用（拖动排序）", "Enabled (drag to reorder)")}</div>
        {enabledDefs.length === 0 && <div className="text-[11px] text-slate-300 mb-2">{t("无", "None")}</div>}
        <div className="space-y-1 mb-2">
          {enabledDefs.map((f) => (
            <div
              key={f.key}
              draggable
              onDragStart={() => { dragKeyRef.current = f.key; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); reorder(templateType, dragKeyRef.current, f.key); }}
              className="flex items-center gap-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 cursor-move"
            >
              <GripVertical size={12} className="text-slate-400 shrink-0" />
              <span className="flex-1">{t(f.zh, f.en)}</span>
              <button
                onClick={() => remove(templateType, f.key)}
                className="text-[11px] text-slate-400 hover:text-rose-600"
                title={t("移除", "Remove")}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>

        {disabledDefs.length > 0 && (
          <>
            <div className="text-[11px] text-slate-400 mb-1">{t("未启用", "Disabled")}</div>
            <div className="flex flex-wrap gap-1.5">
              {disabledDefs.map((f) => (
                <button
                  key={f.key}
                  onClick={() => add(templateType, f.key)}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
                >
                  <Plus size={10} /> {t(f.zh, f.en)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-sm font-medium flex items-center gap-1.5"><Package size={14} className="text-slate-500" /> {t("模板字段设置", "Template Field Settings")}</div>
      <div className="text-xs text-slate-400 mt-1 mb-3">
        {t("选择每种模板要打印的字段，并可拖动调整顺序。客户/收件人资料一律必印且不可编辑，不在下面的选项内。", "Choose which fields print on each template, and drag to reorder them. Customer/recipient info always prints and is never editable — it isn't part of the options below.")}
      </div>
      {settings === null ? (
        <div className="text-xs text-slate-400">{t("加载中…", "Loading…")}</div>
      ) : (
        <div className="space-y-3">
          {renderChecklist("shipping", SHIPPING_TOGGLABLE_FIELDS, t("平台物流面单", "Platform Shipping Label"))}
          {renderChecklist("picking", PICKING_TOGGLABLE_FIELDS, t("仓库拣货单", "Warehouse Picking List"))}
        </div>
      )}
    </div>
  );
}

const DESIGN_POSITION_OPTIONS = [
  { value: "top", zh: "顶部", en: "Top" },
  { value: "productRow", zh: "中部（默认）", en: "Middle (default)" },
  { value: "bottom", zh: "底部", en: "Bottom" },
];
const BARCODE_POSITION_OPTIONS = [
  { value: "top", zh: "顶部（默认，紧邻快递单号）", en: "Top (default, next to tracking no.)" },
  { value: "bottom", zh: "底部", en: "Bottom" },
];
const DESIGN_SIZE_OPTIONS = [
  { value: "small", zh: "小", en: "Small" },
  { value: "medium", zh: "中（默认）", en: "Medium (default)" },
  { value: "large", zh: "大", en: "Large" },
];

function DesignSelect({ label, value, options, onChange }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1 text-[11px] border border-slate-200 rounded-lg outline-none focus:border-slate-400"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.zh}{o.en ? ` / ${o.en}` : ""}</option>)}
      </select>
    </label>
  );
}

// 标签设计 — size/position for image, SKU, a template-level custom text
// block, and barcode position (see ShippingLabelCard's `layoutConfig` prop
// and the DESIGN_ONLY_FIELDS/slot rendering there). Show/hide for these same
// elements stays owned by TemplateFieldSettingsPanel's enabled_fields below
// — this panel is purely "where/how big", never "whether".
//
// customText's actual text content lives here (template-level, always the
// same on every label using this template) — different from the per-print
// SKU/note overrides in LabelEditPanel, which staff type at print time.
function LabelDesignPanel({ t }) {
  const [layoutConfig, setLayoutConfig] = useState(null); // null = loading

  useEffect(() => {
    let cancelled = false;
    supabaseClient
      .from("label_template_settings")
      .select("layout_config")
      .eq("template_type", "shipping")
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setLayoutConfig(error || !data ? {} : data.layout_config || {});
      });
    return () => { cancelled = true; };
  }, []);

  function updateElement(key, patch) {
    const next = { ...layoutConfig, [key]: { ...layoutConfig[key], ...patch } };
    setLayoutConfig(next);
    supabaseClient
      .from("label_template_settings")
      .update({ layout_config: next, updated_at: new Date().toISOString() })
      .eq("template_type", "shipping")
      .then(({ error }) => error && console.error("LabelDesignPanel save failed", error));
  }

  if (layoutConfig === null) return <div className="text-xs text-slate-400">{t("加载中…", "Loading…")}</div>;

  const image = layoutConfig.image || {};
  const sku = layoutConfig.sku || {};
  const customText = layoutConfig.customText || {};
  const barcode = layoutConfig.barcode || {};

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <div className="text-sm font-medium flex items-center gap-1.5">
        <SlidersHorizontal size={14} className="text-slate-500" /> {t("标签设计", "Label Design")}
      </div>
      <div className="text-xs text-slate-400 -mt-2">
        {t(
          "只影响打印标签的显示效果，不会修改产品或订单数据库。显示/隐藏在下方「模板字段设置」中管理。",
          "Only affects how the printed label looks — never changes product/order data in the database. Show/hide is managed in Template Field Settings below.",
        )}
      </div>

      <div className="border-t border-slate-100 pt-3 flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs font-medium text-slate-600 w-24 shrink-0">{t("产品图片", "Product Photo")}</div>
        <div className="flex items-center gap-3">
          <DesignSelect label={t("大小", "Size")} value={image.size || "medium"} options={DESIGN_SIZE_OPTIONS} onChange={(v) => updateElement("image", { size: v })} />
          <DesignSelect label={t("位置", "Position")} value={image.position || "productRow"} options={DESIGN_POSITION_OPTIONS} onChange={(v) => updateElement("image", { position: v })} />
        </div>
      </div>

      <div className="border-t border-slate-100 pt-3 flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs font-medium text-slate-600 w-24 shrink-0">SKU</div>
        <div className="flex items-center gap-3">
          <DesignSelect label={t("大小", "Size")} value={sku.size || "medium"} options={DESIGN_SIZE_OPTIONS} onChange={(v) => updateElement("sku", { size: v })} />
          <DesignSelect label={t("位置", "Position")} value={sku.position || "productRow"} options={DESIGN_POSITION_OPTIONS} onChange={(v) => updateElement("sku", { position: v })} />
        </div>
      </div>

      <div className="border-t border-slate-100 pt-3 space-y-2">
        <div className="text-xs font-medium text-slate-600">{t("自定义文字", "Custom Text")}</div>
        <input
          value={customText.text || ""}
          onChange={(e) => updateElement("customText", { text: e.target.value })}
          placeholder={t("固定显示在标签上的文字，例如感谢语", "Fixed text shown on every label, e.g. a thank-you note")}
          className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-slate-400"
        />
        <div className="flex items-center gap-3">
          <DesignSelect label={t("大小", "Size")} value={customText.size || "medium"} options={DESIGN_SIZE_OPTIONS} onChange={(v) => updateElement("customText", { size: v })} />
          <DesignSelect label={t("位置", "Position")} value={customText.position || "bottom"} options={DESIGN_POSITION_OPTIONS} onChange={(v) => updateElement("customText", { position: v })} />
        </div>
      </div>

      <div className="border-t border-slate-100 pt-3 flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs font-medium text-slate-600 w-24 shrink-0">{t("条码位置", "Barcode Position")}</div>
        <DesignSelect label="" value={barcode.position || "top"} options={BARCODE_POSITION_OPTIONS} onChange={(v) => updateElement("barcode", { position: v })} />
      </div>
    </div>
  );
}

function LabelSettings({ t, stores, onUpdateSellerInfo }) {
  return (
    <div className="space-y-4">
      <SellerSettingsPanel t={t} stores={stores} onUpdateSellerInfo={onUpdateSellerInfo} />
      <LabelDesignPanel t={t} />
      <TemplateFieldSettingsPanel t={t} />
    </div>
  );
}

// Resolves a print_history row's order_id (the real orders.id uuid) back to
// a live order — used by both "查看预览" and "重新打印". Deliberately always
// fetches fresh from `orders`/`order_items` rather than trusting anything
// stored in print_history: recipient/product info is never snapshotted
// there (see the print_history migration comment), so a reprint/preview
// always reflects current, correct data, with only the print-specific
// customization (sku override/note) replayed from history.
const REPRINT_ORDER_COLUMNS = "id, order_no, platform, platform_account_id, buyer_name, buyer_phone, shipping_address, tracking_no, courier, order_status, platform_status, warehouse_stage, is_cod, shipping_fee, order_date, print_count, last_printed_at, last_printed_by, note_color, note_text";
async function fetchOrderForReprint(orderId) {
  const { data: orderRow, error: orderErr } = await supabaseClient
    .from("orders")
    .select(REPRINT_ORDER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr || !orderRow) return null;
  const { data: items } = await supabaseClient
    .from("order_items")
    .select("order_id, sku, product_name, variation, qty, unit_price, image_url")
    .eq("order_id", orderId);
  return { order: mapDbOrder(orderRow, items || []), items: items || [] };
}

// Read-only reconstruction of a historical print, for 查看预览 — fetches the
// order fresh (see fetchOrderForReprint) and renders the same card component
// used for real printing, but with no print button and no edit access.
function HistoryPreviewModal({ t, stores, historyRow, onClose }) {
  // undefined = not fetched yet, null = fetched but the order no longer
  // exists, object = resolved { order, items }. Distinct from `null` on
  // purpose — otherwise "still loading" and "order not found" are
  // indistinguishable and the wrong message shows.
  const [resolved, setResolved] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchOrderForReprint(historyRow.order_id).then((r) => { if (!cancelled) setResolved(r); });
    return () => { cancelled = true; };
  }, [historyRow.order_id]);

  const td = historyRow.template_data || {};

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="text-sm font-medium">{t("历史打印预览", "Historical Print Preview")}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto bg-slate-100 p-4 flex justify-center">
          {!resolved ? (
            <div className="text-xs text-slate-400 py-10">{resolved === undefined ? t("加载中…", "Loading…") : t("该订单已不存在", "This order no longer exists")}</div>
          ) : td.template === "picking" ? (
            <WarehousePickingCard t={t} order={resolved.order} items={resolved.items} enabledFields={null} />
          ) : (
            <ShippingLabelCard
              t={t}
              order={resolved.order}
              fields={{ ...labelFields(resolved.order, stores), ...(td.locked ? {} : { sku: td.sku, note: td.note }) }}
              enabledFields={null}
              layoutConfig={td.locked ? {} : td.layoutConfig}
              locked={!!td.locked}
              items={resolved.items}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// 打印记录 — one row per order actually printed (see handlePrintConfirm's
// print_history insert), auto-expiring after 30 days (cron cleanup on the
// DB side, migration `print_history`). Embeds orders(order_no) via the
// order_id foreign key so this never needs the frontend's order.id (which
// is order_no, not the real uuid PK print_history.order_id points to).
// No edit or delete here — the only mutations this panel triggers are
// "查看预览" (read-only) and "重新打印" (a genuine new print, going through
// the normal onReprint -> PrintSlip -> handlePrintConfirm path, which will
// itself add a new print_history row). The history rows themselves are
// never editable/deletable from the UI — the only deletion path is the
// scheduled cleanup, on purpose (this is a record of what happened).
function PrintHistoryPanel({ t, stores, onReprint }) {
  const [rows, setRows] = useState(null); // null = loading
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all"); // "all" | "locked" | "design"
  const [previewRow, setPreviewRow] = useState(null);
  const [reprintingId, setReprintingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    supabaseClient
      .from("print_history")
      .select("id, order_id, platform, template_data, printed_at, expire_at, orders(order_no)")
      .order("printed_at", { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("PrintHistoryPanel fetch failed", error);
        setRows(error || !data ? [] : data);
      });
    return () => { cancelled = true; };
  }, []);

  const lang = t("zh-CN", "en-MY");
  const filtered = (rows || [])
    .filter((r) => !query.trim() || (r.orders?.order_no || "").toLowerCase().includes(query.toLowerCase()))
    .filter((r) => typeFilter === "all" || (typeFilter === "locked" ? r.template_data?.locked : !r.template_data?.locked));

  async function handleReprint(r) {
    setReprintingId(r.id);
    const resolved = await fetchOrderForReprint(r.order_id);
    setReprintingId(null);
    if (!resolved) { console.error("reprint: order no longer exists", r.order_id); return; }
    const td = r.template_data || {};
    onReprint?.(resolved.order, !!td.locked, td.locked ? {} : { sku: td.sku, note: td.note });
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-sm font-medium mb-1 flex items-center gap-1.5">
        <History size={14} className="text-slate-500" /> {t("打印记录", "Print History")}
      </div>
      <div className="text-xs text-slate-400 mb-3">
        {t("每次打印自动保存，保留 30 天后自动清除，不会影响订单数据", "Every print is logged automatically, kept for 30 days then auto-deleted — never affects order data")}
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("按订单编号筛选", "Filter by order no.")}
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400 mb-2"
      />
      <div className="flex items-center gap-1.5 mb-3">
        {[
          { value: "all", zh: "全部", en: "All" },
          { value: "locked", zh: "平台订单打印单", en: "Platform Order Slip" },
          { value: "design", zh: "标签打印", en: "Label Printing" },
        ].map((f) => (
          <button
            key={f.value}
            onClick={() => setTypeFilter(f.value)}
            className={`text-[11px] px-2.5 py-1 rounded-full border ${typeFilter === f.value ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"}`}
          >
            {t(f.zh, f.en)}
          </button>
        ))}
      </div>
      {rows === null ? (
        <div className="text-xs text-slate-400">{t("加载中…", "Loading…")}</div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-slate-400 text-center py-6">{t("暂无打印记录", "No print history yet")}</div>
      ) : (
        <div className="border border-slate-100 rounded-lg divide-y divide-slate-100 max-h-96 overflow-y-auto">
          {filtered.map((r) => (
            <div key={r.id} className="px-3 py-2 text-xs flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium truncate">{r.orders?.order_no || "—"}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${r.template_data?.locked ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-sky-50 text-sky-700 border border-sky-200"}`}>
                    {r.template_data?.locked ? t("平台订单打印单", "Platform Order Slip") : t("标签打印", "Label Printing")}
                  </span>
                </div>
                <div className="text-slate-400 truncate">
                  {r.platform}
                  {r.template_data?.template ? ` · ${r.template_data.template}` : ""}
                  {r.template_data?.sku ? ` · SKU: ${r.template_data.sku}` : ""}
                </div>
              </div>
              <div className="text-right text-slate-400 shrink-0 flex items-center gap-2">
                <div>
                  <div>{new Date(r.printed_at).toLocaleString(lang)}</div>
                  <div>{t("到期", "Expires")} {new Date(r.expire_at).toLocaleDateString(lang)}</div>
                </div>
                <button
                  onClick={() => setPreviewRow(r)}
                  title={t("查看预览", "View Preview")}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                >
                  <Eye size={12} />
                </button>
                <button
                  onClick={() => handleReprint(r)}
                  disabled={reprintingId === r.id}
                  title={t("重新打印", "Reprint")}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                >
                  <Printer size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {previewRow && <HistoryPreviewModal t={t} stores={stores} historyRow={previewRow} onClose={() => setPreviewRow(null)} />}
    </div>
  );
}

export function LabelPrinting({ t, orders, stores, onPrint, onReprint, onUpdateSellerInfo }) {
  const [view, setView] = useState("print"); // "print" | "design" | "history"
  const [printQuery, setPrintQuery] = useState("");
  const [printSelectedIds, setPrintSelectedIds] = useState(() => new Set());
  const printMatches = printQuery.trim()
    ? orders.filter((o) =>
        o.id.toLowerCase().includes(printQuery.toLowerCase()) ||
        o.customer.includes(printQuery) ||
        (o.sku || "").toLowerCase().includes(printQuery.toLowerCase())
      ).slice(0, 8)
    : [];

  function togglePrintSelect(id) {
    setPrintSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handlePrintSelected() {
    // Oldest-first (FIFO), not selection order, so a batch always prints in
    // a predictable sequence regardless of which orders were checked when.
    const selected = orders.filter((o) => printSelectedIds.has(o.id)).sort((a, b) => a.date.localeCompare(b.date));
    if (selected.length > 0) {
      onPrint?.(selected);
      setPrintSelectedIds(new Set());
      setPrintQuery("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setView("print")}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${view === "print" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"}`}
        >
          <Printer size={12} /> {t("标签打印", "Label Printing")}
        </button>
        <button
          onClick={() => setView("design")}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${view === "design" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"}`}
        >
          <SlidersHorizontal size={12} /> {t("标签设计", "Label Design")}
        </button>
        <button
          onClick={() => setView("history")}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${view === "history" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"}`}
        >
          <History size={12} /> {t("打印记录", "Print History")}
        </button>
      </div>

      {view === "design" ? (
        <LabelSettings t={t} stores={stores} onUpdateSellerInfo={onUpdateSellerInfo} />
      ) : view === "history" ? (
        <PrintHistoryPanel t={t} stores={stores} onReprint={onReprint} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-sm font-medium mb-3 flex items-center gap-1.5"><Printer size={14} className="text-slate-500"/> {t("标签打印", "Label Printing")}</div>
          <input
            value={printQuery}
            onChange={(e) => setPrintQuery(e.target.value)}
            placeholder={t("搜索订单编号 / 客户 / SKU", "Search order no. / customer / SKU")}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-slate-400"
          />
          {printMatches.length > 0 && (
            <div className="mt-2 border border-slate-100 rounded-lg divide-y divide-slate-100 max-h-56 overflow-y-auto">
              {printMatches.map((o) => (
                <label key={o.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                  <input type="checkbox" checked={printSelectedIds.has(o.id)} onChange={() => togglePrintSelect(o.id)} className="h-3.5 w-3.5 rounded border-slate-300" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{o.id}</div>
                    <div className="text-xs text-slate-400 truncate">{o.customer} · {o.product}</div>
                  </div>
                </label>
              ))}
            </div>
          )}
          <button
            onClick={handlePrintSelected}
            disabled={printSelectedIds.size === 0}
            className={`mt-3 flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg text-white ${printSelectedIds.size > 0 ? "bg-slate-900 hover:bg-slate-800" : "bg-slate-300 cursor-not-allowed"}`}
          >
            <Printer size={14} /> {t(`打印已选 (${printSelectedIds.size})`, `Print Selected (${printSelectedIds.size})`)}
          </button>
        </div>
      )}
    </div>
  );
}

export function AIPanel({ t, orders, inventory }) {
  const [messages, setMessages] = useState([
    { from: "customer", text: "你好，请问我的包裹到哪里了？" },
    { from: "ai", text: aiReply("追踪") },
  ]);
  const [input, setInput] = useState("");
  const suggestions = restockSuggestions(inventory);
  const topSelling = [...orders.reduce((map, o) => {
    map.set(o.sku, (map.get(o.sku) || 0) + o.qty);
    return map;
  }, new Map())].sort((a, b) => b[1] - a[1]).slice(0, 5);

  function send() {
    if (!input.trim()) return;
    const reply = aiReply(input);
    setMessages((m) => [...m, { from: "customer", text: input }, { from: "ai", text: reply }]);
    setInput("");
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-sm font-medium mb-3 flex items-center gap-1.5"><TrendingUp size={14} className="text-teal-500"/> {t("热销商品 Top 5", "Top 5 Best Sellers")}</div>
          <div className="space-y-2">
            {topSelling.map(([sku, qty], i) => {
              const product = PRODUCTS.find((p) => p.sku === sku);
              return (
                <div key={sku} className="flex items-center justify-between text-sm border-b border-slate-100 pb-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-4">{i + 1}</span>
                    <div>
                      <div className="font-medium">{product?.name}</div>
                      <div className="text-xs text-slate-400">{sku}</div>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-teal-600 tabular-nums">{t(`${qty} 件`, `${qty} pcs`)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-sm font-medium mb-3 flex items-center gap-1.5"><Sparkles size={14} className="text-indigo-500"/> {t("AI 补货建议", "AI Restock Suggestions")}</div>
          <div className="space-y-2">
            {suggestions.slice(0, 5).map((s) => (
              <div key={s.sku} className="flex items-center justify-between text-sm border-b border-slate-100 pb-2 last:border-0">
                <div>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-slate-400">{t(`预计 ${s.daysLeft} 天后售罄`, `Est. sold out in ${s.daysLeft} days`)}</div>
                </div>
                <span className="text-xs font-semibold text-indigo-600 tabular-nums">{t(`建议补货 ${s.suggestedQty} 件`, `Suggest restock ${s.suggestedQty}`)}</span>
              </div>
            ))}
            {suggestions.length === 0 && <div className="text-xs text-slate-400">{t("当前所有 SKU 库存充足，暂无补货建议。", "All SKUs currently have sufficient stock — no restock suggestions.")}</div>}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-sm font-medium mb-3 flex items-center gap-1.5"><Bot size={14} className="text-teal-500"/> {t("AI 客服自动回复演示", "AI Customer Service Auto-Reply Demo")}</div>
        <div className="border border-slate-100 rounded-lg h-64 overflow-y-auto p-3 space-y-2 bg-slate-50">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.from === "ai" ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[70%] text-sm px-3 py-2 rounded-lg ${m.from === "ai" ? "bg-white border border-slate-200 text-slate-700" : "bg-teal-500 text-white"}`}>
                {m.text}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={t("以客户身份输入问题，例如：可以退款吗？", "Type a question as a customer, e.g.: Can I get a refund?")}
            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:border-teal-400"
          />
          <button onClick={send} className="px-3 py-2 bg-slate-900 text-white rounded-lg text-sm flex items-center gap-1.5 hover:bg-slate-800">
            <Send size={14} /> {t("发送", "Send")}
          </button>
        </div>
        <div className="text-xs text-slate-400 mt-2">{t("试试输入包含\"追踪\"、\"退款\"、\"尺码\"或\"优惠\"的问题", "Try a question containing \"tracking\", \"refund\", \"size\" or \"discount\"")}</div>
      </div>
    </div>
  );
}

/* ============================== Roles ============================== */
// 员工帐号管理 + 角色权限设定 (2026-08-20, Plan A, approved) — real Supabase
// Auth accounts via the admin-manage-staff Edge Function (only server-side
// code ever touches auth.admin.*, this component only calls the function);
// role_permissions matrix is a real table, editable, but Plan A scope: it
// records intent only, doesn't yet gate any other module's actual RLS.

// 手机号虚拟 Email 显示还原 (2026-08-20) — accounts created from a bare
// phone number are stored as phone@myerp.local (see admin-manage-staff's
// toAuthEmail, same convention/domain), so the list shows the raw phone
// number instead of a confusing fake-looking email address.
const VIRTUAL_EMAIL_DOMAIN = "myerp.local";
function displayAccount(email) {
  if (!email) return "";
  const suffix = `@${VIRTUAL_EMAIL_DOMAIN}`;
  return email.endsWith(suffix) ? email.slice(0, -suffix.length) : email;
}

const ROLE_META = {
  admin: { zh: "管理员", en: "Admin" },
  purchasing: { zh: "采购专员", en: "Purchasing" },
  warehouse: { zh: "仓管", en: "Warehouse" },
  finance: { zh: "财务", en: "Finance" },
  customer_service: { zh: "客服", en: "Customer Service" },
};
const ROLE_KEYS = Object.keys(ROLE_META);
const MODULE_EN = { 订单: "Orders", 库存: "Inventory", 财务: "Finance", AI: "AI", 权限: "Roles" };
const MODULES = ["订单", "库存", "财务", "AI", "权限"];

// Reads the real error message out of a non-2xx admin-manage-staff response
// — supabase-js's functions.invoke() only gives a generic "non-2xx" error by
// default, the actual { error: "..." } body lives on error.context (a real
// Response object) and has to be read separately.
async function callStaffApi(action, extra) {
  const { data, error } = await supabaseClient.functions.invoke("admin-manage-staff", { body: { action, ...extra } });
  if (error) {
    let message = error.message;
    try {
      if (error.context && typeof error.context.json === "function") {
        const body = await error.context.json();
        if (body?.error) message = body.error;
      }
    } catch { /* fall back to the generic message */ }
    return { data: null, error: message };
  }
  if (data?.error) return { data: null, error: data.error };
  return { data, error: null };
}

export function Roles({ t }) {
  const lang = t("zh", "en");
  const [staff, setStaff] = useState([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [permissions, setPermissions] = useState([]);
  const [stores, setStores] = useState([]); // real platform_accounts, for 店铺权限授权 checkboxes
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null); // null = create mode
  const [form, setForm] = useState({ fullName: "", email: "", password: "", role: ROLE_KEYS[0], status: "active", storeIds: [] });
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState(null);
  // 重置密码弹窗 (2026-08-20, fixed) — was window.prompt(), which the user
  // reported as a silent no-op on click; a real modal (same pattern as the
  // create/edit modal) doesn't depend on the browser's native prompt().
  const [resetTarget, setResetTarget] = useState(null); // staff row being reset, or null
  const [resetPassword, setResetPassword] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState("");

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function loadStaff() {
    setStaffLoading(true);
    const { data, error } = await callStaffApi("list", {});
    if (!error) setStaff(data.staff || []);
    else console.error("loadStaff failed", error);
    setStaffLoading(false);
  }

  async function loadPermissions() {
    const { data, error } = await supabaseClient.from("role_permissions").select("role, module, allowed");
    if (!error) setPermissions(data || []);
    else console.error("loadPermissions failed", error);
  }

  // 店铺权限授权 (2026-08-20) — real connected Shopee/TikTok stores for the
  // checkbox list. Excludes hidden=true stores (same convention the store
  // list elsewhere in this app already uses for retired/broken accounts —
  // e.g. the legacy Shopee shop with a dead OAuth token).
  async function loadStores() {
    const { data, error } = await supabaseClient.from("platform_accounts").select("id, platform, account_name").eq("hidden", false).order("platform").order("account_name");
    if (!error) setStores(data || []);
    else console.error("loadStores failed", error);
  }

  useEffect(() => { loadStaff(); loadPermissions(); loadStores(); }, []);

  function openCreateModal() {
    setEditingStaff(null);
    setForm({ fullName: "", email: "", password: "", role: ROLE_KEYS[0], status: "active", storeIds: [] });
    setErrorMsg("");
    setModalOpen(true);
  }

  function openEditModal(s) {
    setEditingStaff(s);
    setForm({ fullName: s.fullName, email: displayAccount(s.email), password: "", role: ROLE_KEYS.includes(s.role) ? s.role : ROLE_KEYS[0], status: s.status, storeIds: s.storeIds || [] });
    setErrorMsg("");
    setModalOpen(true);
  }

  function toggleFormStoreId(id) {
    setForm((f) => ({ ...f, storeIds: f.storeIds.includes(id) ? f.storeIds.filter((x) => x !== id) : [...f.storeIds, id] }));
  }

  async function submitModal() {
    setErrorMsg("");
    if (!form.fullName.trim()) { setErrorMsg(t("请输入员工姓名", "Please enter a name")); return; }
    setBusy(true);
    if (editingStaff) {
      const { error } = await callStaffApi("update", { userId: editingStaff.id, fullName: form.fullName, role: form.role, storeIds: form.storeIds });
      if (error) { setBusy(false); setErrorMsg(error); return; }
      if (form.status !== editingStaff.status) {
        const { error: statusErr } = await callStaffApi("setStatus", { userId: editingStaff.id, status: form.status });
        if (statusErr) { setBusy(false); setErrorMsg(statusErr); return; }
      }
      setBusy(false);
      setModalOpen(false);
      showToast(t("已更新工作人员", "Staff account updated"));
      loadStaff();
    } else {
      if (!form.email.trim() || !form.password) { setBusy(false); setErrorMsg(t("请填写登入帐号与预设密码", "Please fill in the login email and default password")); return; }
      const { data, error } = await callStaffApi("create", { fullName: form.fullName, email: form.email, password: form.password, role: form.role, storeIds: form.storeIds });
      if (error) { setBusy(false); setErrorMsg(error); return; }
      if (form.status === "disabled" && data?.id) {
        await callStaffApi("setStatus", { userId: data.id, status: "disabled" });
      }
      setBusy(false);
      setModalOpen(false);
      showToast(t("已创建工作人员帐号", "Staff account created"));
      loadStaff();
    }
  }

  function openResetPasswordModal(s) {
    setResetTarget(s);
    setResetPassword("");
    setResetError("");
  }

  async function submitResetPassword() {
    if (!resetTarget) return;
    if (resetPassword.length < 6) { setResetError(t("密码至少需要6位", "Password must be at least 6 characters")); return; }
    setResetBusy(true);
    const { error } = await callStaffApi("resetPassword", { userId: resetTarget.id, newPassword: resetPassword });
    setResetBusy(false);
    if (error) { setResetError(error); return; }
    setResetTarget(null);
    showToast(t("密码重置成功", "Password reset successfully"));
  }

  async function handleToggleStatus(s) {
    const nextStatus = s.status === "active" ? "disabled" : "active";
    if (nextStatus === "disabled" && !window.confirm(t(`确定要禁用「${s.fullName}」的帐号吗？禁用后该帐号将无法登入。`, `Disable "${s.fullName}"'s account? They won't be able to log in while disabled.`))) return;
    const { error } = await callStaffApi("setStatus", { userId: s.id, status: nextStatus });
    if (error) { window.alert(error); return; }
    loadStaff();
  }

  async function handleDelete(s) {
    if (!window.confirm(t(`确定要删除工作人员「${s.fullName}」吗？此操作无法撤销。`, `Delete staff account "${s.fullName}"? This cannot be undone.`))) return;
    const { error } = await callStaffApi("delete", { userId: s.id });
    if (error) { window.alert(error); return; }
    showToast(t("已删除工作人员", "Staff account deleted"));
    loadStaff();
  }

  // Plan A: real, persisted, owner-editable — but display-only intent, not
  // yet wired into any other table's RLS (see module comment above).
  async function togglePermission(role, module) {
    const current = permissions.find((p) => p.role === role && p.module === module);
    const nextAllowed = !(current?.allowed ?? false);
    setPermissions((prev) => {
      const exists = prev.some((p) => p.role === role && p.module === module);
      if (exists) return prev.map((p) => (p.role === role && p.module === module ? { ...p, allowed: nextAllowed } : p));
      return [...prev, { role, module, allowed: nextAllowed }];
    });
    const { error } = await supabaseClient.from("role_permissions")
      .upsert({ role, module, allowed: nextAllowed, updated_at: new Date().toISOString() }, { onConflict: "role,module" });
    if (error) { console.error("togglePermission failed", error); loadPermissions(); }
  }

  const userCountByRole = ROLE_KEYS.reduce((acc, r) => { acc[r] = staff.filter((s) => s.role === r).length; return acc; }, {});

  return (
    <div className="space-y-4">
      {/* 员工帐号管理 */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5 text-sm font-medium"><Users size={14} className="text-slate-500" /> {t("员工帐号管理", "Staff Account Management")}</div>
          <button onClick={openCreateModal} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700">
            <Plus size={13} /> {t("新增工作人员", "Add Staff")}
          </button>
        </div>
        {staffLoading ? (
          <div className="text-xs text-slate-400 py-6 text-center">{t("加载中…", "Loading…")}</div>
        ) : staff.length === 0 ? (
          <div className="text-xs text-slate-400 py-6 text-center">{t("暂无工作人员", "No staff accounts yet")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                  <th className="py-2 pr-3 font-medium">{t("姓名", "Name")}</th>
                  <th className="py-2 pr-3 font-medium">{t("账号", "Email")}</th>
                  <th className="py-2 pr-3 font-medium">{t("角色", "Role")}</th>
                  <th className="py-2 pr-3 font-medium">{t("状态", "Status")}</th>
                  <th className="py-2 pr-3 font-medium">{t("最后登录时间", "Last Login")}</th>
                  <th className="py-2 pr-3 font-medium text-right">{t("操作", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 pr-3 font-medium">{s.fullName}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{displayAccount(s.email)}</td>
                    <td className="py-2.5 pr-3">
                      {ROLE_KEYS.includes(s.role)
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{t(ROLE_META[s.role].zh, ROLE_META[s.role].en)}</span>
                        : <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">{s.role}</span>}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${s.status === "active" ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-slate-100 text-slate-400 border-slate-200"}`}>
                        {s.status === "active" ? t("启用", "Active") : t("禁用", "Disabled")}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-slate-500 text-xs tabular-nums">
                      {s.lastSignInAt ? new Date(s.lastSignInAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-US") : t("从未登录", "Never")}
                    </td>
                    <td className="py-2.5 pr-3">
                      {/* owner 帐号不透过此弹窗管理 (2026-08-20 fix) — 'owner'
                          isn't in ROLE_KEYS, so opening the edit modal on an
                          owner row silently reset its role dropdown to
                          "管理员"; saving would have downgraded a real owner
                          to admin. Since owner already implicitly has full
                          access to everything (incl. all stores), managing
                          it through this generic staff modal was never
                          meaningful anyway — just show a plain label. */}
                      {s.role === "owner" ? (
                        <div className="text-right text-[11px] text-slate-400">{t("所有者帐号", "Owner account")}</div>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={() => openEditModal(s)} title={t("编辑", "Edit")} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><Pencil size={13} /></button>
                          <button onClick={() => openResetPasswordModal(s)} title={t("重置密码", "Reset Password")} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><KeyRound size={13} /></button>
                          <button onClick={() => handleToggleStatus(s)} title={s.status === "active" ? t("禁用", "Disable") : t("启用", "Enable")} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><Ban size={13} /></button>
                          <button onClick={() => handleDelete(s)} title={t("删除", "Delete")} className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50"><Trash2 size={13} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 角色与权限矩阵 */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center gap-1.5 text-sm font-medium mb-3"><ShieldCheck size={14} className="text-slate-500" /> {t("角色与权限矩阵", "Roles & Permissions Matrix")}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[500px]">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                <th className="py-2 pr-3 font-medium">{t("角色", "Role")}</th>
                <th className="py-2 pr-3 font-medium">{t("用户数", "Users")}</th>
                {MODULES.map((m) => (<th key={m} className="py-2 pr-3 font-medium text-center">{t(m, MODULE_EN[m] || m)}</th>))}
              </tr>
            </thead>
            <tbody>
              {ROLE_KEYS.map((roleKey) => (
                <tr key={roleKey} className="border-b border-slate-100 last:border-0">
                  <td className="py-2.5 pr-3 font-medium">{t(ROLE_META[roleKey].zh, ROLE_META[roleKey].en)}</td>
                  <td className="py-2.5 pr-3 tabular-nums text-slate-500">{userCountByRole[roleKey]}</td>
                  {MODULES.map((m) => {
                    const perm = permissions.find((p) => p.role === roleKey && p.module === m);
                    const allowed = perm?.allowed ?? false;
                    return (
                      <td key={m} className="py-2.5 pr-3 text-center">
                        <button onClick={() => togglePermission(roleKey, m)} className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-slate-50">
                          {allowed ? <CheckCircle2 size={16} className="text-emerald-500" /> : <span className="inline-block h-3.5 w-3.5 rounded border border-slate-300" />}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] text-slate-400 mt-3">
          {t("提示：以上权限矩阵目前仅作记录用途，尚未与各模块的实际访问权限联动。", "Note: this matrix currently records intent only — it doesn't yet gate actual access to other modules.")}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] bg-slate-900 text-white text-xs px-4 py-2.5 rounded-lg shadow-lg">{toast}</div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{editingStaff ? t("编辑工作人员", "Edit Staff") : t("新增工作人员", "Add Staff")}</div>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t("员工姓名", "Full Name")}</label>
                <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-teal-400" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t("登录账号（手机号 / Email）", "Login Account (Phone / Email)")}</label>
                <input
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  disabled={!!editingStaff}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-teal-400 disabled:bg-slate-50 disabled:text-slate-400"
                />
                {/* 2026-08-20: label accepts either, but real login still only
                    works with a valid email format — Supabase Auth account
                    creation requires it, and phone/WhatsApp OTP auth was
                    explicitly not built (no third-party OTP provider
                    connected). Entering a bare phone number here will fail
                    at account creation, not silently succeed. */}
                {!editingStaff && (
                  <div className="text-[11px] text-slate-400 mt-1">{t("目前仅支持邮箱登录；手机号登录需另外接入短信/WhatsApp服务商，尚未开通", "Only email login works today; phone login needs a separate SMS/WhatsApp provider, not yet connected")}</div>
                )}
                {editingStaff && <div className="text-[11px] text-slate-400 mt-1">{t("邮箱创建后不可修改", "Email can't be changed after account creation")}</div>}
              </div>
              {!editingStaff && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">{t("预设密码", "Default Password")}</label>
                  <input
                    type="text"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder={t("至少6位", "Min 6 characters")}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-teal-400"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t("所属角色", "Role")}</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-teal-400">
                  {ROLE_KEYS.map((r) => (<option key={r} value={r}>{t(ROLE_META[r].zh, ROLE_META[r].en)}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t("帐号状态", "Account Status")}</label>
                <button
                  onClick={() => setForm({ ...form, status: form.status === "active" ? "disabled" : "active" })}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border ${form.status === "active" ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}
                >
                  {form.status === "active" ? <CheckCircle2 size={13} /> : <Ban size={13} />}
                  {form.status === "active" ? t("启用", "Active") : t("禁用", "Disabled")}
                </button>
              </div>
              {/* 店铺权限授权 (2026-08-20) — owner isn't assignable via this
                  modal (see ALLOWED_ROLES), so the "owner 预设拥有所有店铺权限"
                  case never applies here; this list is only ever shown for
                  the 5 non-owner roles, which always need an explicit grant. */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs text-slate-400">{t("可存取店铺", "Accessible Stores")}</label>
                  {stores.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, storeIds: form.storeIds.length === stores.length ? [] : stores.map((s) => s.id) })}
                      className="text-[11px] text-teal-600 hover:underline"
                    >
                      {form.storeIds.length === stores.length ? t("取消全选", "Deselect all") : t("全选", "Select all")}
                    </button>
                  )}
                </div>
                {stores.length === 0 ? (
                  <div className="text-xs text-slate-400">{t("暂无已连接店铺", "No connected stores yet")}</div>
                ) : (
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-40 overflow-y-auto">
                    {stores.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-slate-50">
                        <input type="checkbox" checked={form.storeIds.includes(s.id)} onChange={() => toggleFormStoreId(s.id)} className="accent-teal-600" />
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.platform === "shopee" ? "bg-orange-100 text-orange-600" : "bg-slate-800 text-white"}`}>
                          {s.platform === "shopee" ? "Shopee" : "TikTok"}
                        </span>
                        <span className="truncate">{s.account_name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {errorMsg && <div className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{errorMsg}</div>}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModalOpen(false)} className="text-xs px-3 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">{t("取消", "Cancel")}</button>
              <button onClick={submitModal} disabled={busy} className="text-xs px-4 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
                {busy ? t("处理中…", "Working…") : t("保存", "Save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 重置密码弹窗 (2026-08-20) — real modal, not window.prompt() (which
          the user found silently did nothing on click). */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold flex items-center gap-1.5"><KeyRound size={15} className="text-slate-500" /> {t("重置员工密码", "Reset Staff Password")}</div>
              <button onClick={() => setResetTarget(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <div className="font-medium">{resetTarget.fullName}</div>
                <div className="text-xs text-slate-500">{displayAccount(resetTarget.email)}</div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t("新密码", "New Password")}</label>
                <input
                  type="text"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder={t("至少6位", "Min 6 characters")}
                  autoFocus
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:border-teal-400"
                />
              </div>
              {resetError && <div className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{resetError}</div>}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setResetTarget(null)} className="text-xs px-3 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">{t("取消", "Cancel")}</button>
              <button onClick={submitResetPassword} disabled={resetBusy} className="text-xs px-4 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
                {resetBusy ? t("处理中…", "Working…") : t("确定", "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================== Ads spend (广告费用) ============================== */

// AI 广告智能管家 — data source note (2026-08-24): ad_campaigns is a real
// Supabase table, but every spend/click/order/revenue number in it is
// MANUALLY entered by staff (via the "新增广告" form below) — there is no
// TikTok Marketing API / Shopee Ads API integration in this project (only
// the Order/Settlement APIs are connected). So every KPI, chart, and AI
// diagnosis on this page is only as accurate as what staff typed in; this
// is a deliberate scope decision (confirmed with the user 2026-08-24), not
// an oversight. The "潜力商品" recommendation below is grounded in real
// order_items sales data (via the `orders` prop, same source AIPanel's Top
// Sellers card uses) rather than a fabricated "conversion rate" — this
// project has no ad-impression/traffic data at all, so a true conversion
// rate can't be computed; recent real order volume is used as an honest
// proxy instead, and labeled as such in the UI (not called "转化率").
// "🤖 一键采纳 AI 优化" never touches any real ad platform (no API to call)
// — it only writes ai_action_note/ai_action_taken_at (and, for stop-loss
// suggestions, status='paused') on this table, as a record of the decision
// staff acted on; the actual budget/bid change still has to be made by a
// human in TikTok/Shopee's own ads console.
const AI_LOOKBACK_DAYS = 30;
const AI_NEW_PRODUCT_MIN_ORDERS = 5;

function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function AdsSpend({ t, orders, stores }) {
  const [activePlatform, setActivePlatform] = useState("Shopee");
  const theme = PLATFORM_THEME[activePlatform];

  // 店铺隔离 (2026-08-24, new) — null = 该平台全部店铺 (no filter). `stores`
  // is the same already-loaded real platform_accounts list Finance/Roles
  // use elsewhere (no new fetch here).
  const [selectedStoreId, setSelectedStoreId] = useState(null);
  const storesForPlatform = (stores || []).filter((s) => s.platform === activePlatform);
  function switchPlatform(pf) {
    setActivePlatform(pf);
    setSelectedStoreId(null); // avoid carrying a store id from the other platform
  }

  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ platform: "Shopee", name: "", sku: "", spend: "", clicks: "", orders: "", revenue: "", platform_account_id: "" });
  const [aiTarget, setAiTarget] = useState(null); // { mode: "stop_loss" | "new_product", campaign?, product? }
  const [aiNote, setAiNote] = useState("");
  const [showCopyGen, setShowCopyGen] = useState(false);
  const [showRoasReport, setShowRoasReport] = useState(false);
  const [showNegExtractor, setShowNegExtractor] = useState(false);
  const [copyForm, setCopyForm] = useState({ productName: "", price: "", langs: { zh: true, en: true, ms: false } });
  const [copyResult, setCopyResult] = useState(null);
  const [negText, setNegText] = useState("");
  const [negResult, setNegResult] = useState(null);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function loadCampaigns() {
    setLoading(true);
    const { data, error } = await supabaseClient.from("ad_campaigns").select("*").order("created_at", { ascending: false });
    if (!error) setCampaigns(data || []);
    else console.error("loadCampaigns failed", error);
    setLoading(false);
  }
  useEffect(() => { loadCampaigns(); }, []);

  function openCreateModal(prefill) {
    setEditingId(null);
    setForm({ platform: activePlatform, name: "", sku: "", spend: "", clicks: "", orders: "", revenue: "", platform_account_id: selectedStoreId || "", ...prefill });
    setShowForm(true);
  }
  function openEditModal(c) {
    setEditingId(c.id);
    setForm({ platform: c.platform, name: c.name, sku: c.sku || "", spend: String(c.spend), clicks: String(c.clicks), orders: String(c.orders), revenue: String(c.revenue), platform_account_id: c.platform_account_id || "" });
    setShowForm(true);
  }

  async function saveForm() {
    if (!form.name.trim()) { showToast(t("请填写广告名称", "Please enter a campaign name")); return; }
    const payload = {
      platform: form.platform,
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      spend: Number(form.spend) || 0,
      clicks: Math.round(Number(form.clicks) || 0),
      orders: Math.round(Number(form.orders) || 0),
      revenue: Number(form.revenue) || 0,
      platform_account_id: form.platform_account_id || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = editingId
      ? await supabaseClient.from("ad_campaigns").update(payload).eq("id", editingId)
      : await supabaseClient.from("ad_campaigns").insert(payload);
    if (error) { showToast(t("保存失败", "Save failed")); console.error("saveForm failed", error); return; }
    setShowForm(false);
    showToast(t("已保存", "Saved"));
    loadCampaigns();
  }

  async function deleteCampaign(id) {
    const { error } = await supabaseClient.from("ad_campaigns").delete().eq("id", id);
    if (error) { showToast(t("删除失败", "Delete failed")); console.error("deleteCampaign failed", error); return; }
    showToast(t("已删除", "Deleted"));
    loadCampaigns();
  }

  // 一键采纳 AI 优化 — see the data-source note above the component for
  // exactly what this does and doesn't do (records a decision, never calls
  // a real ads API).
  async function confirmAiAction() {
    if (!aiTarget) return;
    if (aiTarget.mode === "stop_loss") {
      const { error } = await supabaseClient.from("ad_campaigns").update({
        status: "paused",
        ai_action_note: aiNote || t("AI 建议已采纳：因 ROAS 低于目标，暂停该广告", "AI suggestion adopted: paused due to ROAS below target"),
        ai_action_taken_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", aiTarget.campaign.id);
      if (error) { showToast(t("操作失败", "Action failed")); console.error("confirmAiAction failed", error); setAiTarget(null); return; }
      showToast(t("已标记暂停，请记得在广告后台同步执行", "Marked paused — remember to action this in the real ads console"));
    } else {
      const { error } = await supabaseClient.from("ad_campaigns").insert({
        platform: activePlatform,
        platform_account_id: selectedStoreId || null,
        name: t(`AI 推荐新广告 - ${aiTarget.product.name}`, `AI-Recommended Campaign - ${aiTarget.product.name}`),
        sku: aiTarget.product.sku,
        spend: 0, clicks: 0, orders: 0, revenue: 0,
        status: "active",
        ai_action_note: aiNote || t("AI 建议已采纳：该商品近期真实销量高但未投放广告，已建档待开启", "AI suggestion adopted: high real recent sales with no ads yet — record created, pending launch"),
        ai_action_taken_at: new Date().toISOString(),
      });
      if (error) { showToast(t("操作失败", "Action failed")); console.error("confirmAiAction failed", error); setAiTarget(null); return; }
      showToast(t("已建档，请在广告后台实际开启投放", "Draft campaign recorded — launch it for real in the ads console"));
    }
    setAiTarget(null);
    setAiNote("");
    loadCampaigns();
  }

  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(okMsg || t("已复制", "Copied"));
    } catch {
      showToast(t("复制失败，请手动复制", "Copy failed — please copy manually"));
    }
  }

  // 🤖 AI 广告文案与脚本生成器 (2026-08-24, new) — deterministic template
  // generator (same "rule-based, not a real LLM call" pattern this project
  // already uses for its AI 客服 auto-reply, see aiReply() above); fills
  // real staff-provided product name/price into a few short-video-hook and
  // listing-copy templates per language. Not a call to any external AI API
  // — no such integration/key exists in this project.
  function generateAdScripts(f) {
    const name = f.productName.trim() || t("这款商品", "this product");
    const priceLine = f.price ? t(`只要 RM${f.price}`, `only RM${f.price}`) : t("现在下单更划算", "a great deal right now");
    const templates = {
      zh: {
        label: "中文",
        hook: `别划走！${name}真的绝了 🔥`,
        body: `${name}，${priceLine}，今天下单享最后一波福利，手慢无！`,
        cta: `👉 点击购物车立即下单`,
      },
      en: {
        label: "English",
        hook: `Wait — don't scroll past ${name}! 🔥`,
        body: `${name} is ${priceLine.replace("只要 ", "").replace("现在下单更划算", "a great deal right now")} — grab it before this batch runs out.`,
        cta: `👉 Tap the cart icon to order now`,
      },
      ms: {
        label: "Bahasa Melayu",
        hook: `Jangan skip! ${name} memang power 🔥`,
        body: `${name}, ${f.price ? `cuma RM${f.price}` : "harga terbaik sekarang"}, order hari ini sebelum kehabisan stok!`,
        cta: `👉 Tekan troli untuk order sekarang`,
      },
    };
    return Object.entries(templates)
      .filter(([code]) => f.langs[code])
      .map(([code, tpl]) => ({ code, ...tpl }));
  }

  // 🔍 AI 否定词提取助手 (2026-08-24, new) — pure parsing/filtering of
  // whatever the staff pastes in (their own real search-term report copied
  // from TikTok/Shopee Ads Manager) — every number here is theirs, nothing
  // guessed. Expected format: one search term per line, fields separated by
  // tab or comma: 搜索词, 花费, 点击, 订单. A row is flagged as a negative
  // candidate only when it has real spend > 0 and a real, explicitly parsed
  // orders value of 0 — rows with a missing/unparseable orders field are
  // skipped rather than guessed at.
  function parseNegativeKeywords(text) {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const rows = [];
    for (const line of lines) {
      const parts = (line.includes("\t") ? line.split("\t") : line.split(",")).map((p) => p.trim());
      if (parts.length < 4) continue;
      const [term, spendStr, clicksStr, ordersStr] = parts;
      const spend = Number(spendStr.replace(/[^0-9.]/g, ""));
      const clicks = Number(clicksStr.replace(/[^0-9.]/g, ""));
      const orders = Number(ordersStr.replace(/[^0-9.]/g, ""));
      if (!term || Number.isNaN(spend) || Number.isNaN(orders)) continue;
      rows.push({ term, spend, clicks: Number.isNaN(clicks) ? 0 : clicks, orders });
    }
    return rows.filter((r) => r.spend > 0 && r.orders === 0).sort((a, b) => b.spend - a.spend);
  }

  const allRows = campaigns.map((c) => ({ ...c, roas: c.spend > 0 ? c.revenue / c.spend : 0 }));
  // 店铺隔离 — when a specific store is picked, only that store's real rows
  // count towards every KPI/chart/table/AI diagnosis below; null keeps the
  // previous "all stores on this platform" behavior.
  const rows = allRows.filter((c) => c.platform === activePlatform && (!selectedStoreId || c.platform_account_id === selectedStoreId));

  const totalSpend = rows.reduce((s, c) => s + c.spend, 0);
  const totalRevenue = rows.reduce((s, c) => s + c.revenue, 0);
  const overallRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const effectiveCount = rows.filter((c) => c.roas >= AD_ROAS_THRESHOLD).length;

  // AI 止损预警 — real rows only: active campaigns on this platform/store,
  // real spend > 0 (so a freshly-created RM0 draft never gets flagged),
  // real ROAS below the configured threshold.
  const stopLossFlags = rows.filter((c) => c.status === "active" && c.spend > 0 && c.roas < AD_ROAS_THRESHOLD);

  // AI 潜力商品推荐 — real order_items sales (via the already-loaded
  // `orders` prop, last AI_LOOKBACK_DAYS days, this platform/store only),
  // excluding any SKU that already has a campaign row on this platform.
  const since = daysAgoStr(AI_LOOKBACK_DAYS);
  const adSkus = new Set(rows.map((c) => (c.sku || "").trim().toLowerCase()).filter(Boolean));
  const salesBySku = new Map();
  // 关联产品图片/名称 (2026-08-24, new) — real sku -> {name, image} lookup
  // built from the same already-loaded `orders` prop (each order's real
  // order_items), used by the detail table's new 关联产品 column below.
  const skuInfo = new Map();
  for (const o of orders || []) {
    for (const it of o.items && o.items.length > 0 ? o.items : [{ sku: o.sku, productName: o.product, image: o.productImage }]) {
      if (!it.sku || skuInfo.has(it.sku.trim().toLowerCase())) continue;
      skuInfo.set(it.sku.trim().toLowerCase(), { name: it.productName, image: it.image });
    }
    if (o.platform !== activePlatform || (selectedStoreId && o.platformAccountId !== selectedStoreId) || !o.sku || o.date < since) continue;
    const key = o.sku.trim().toLowerCase();
    const cur = salesBySku.get(key) || { sku: o.sku, name: o.product, orderCount: 0 };
    cur.orderCount += 1;
    salesBySku.set(key, cur);
  }
  const newProductFlags = [...salesBySku.values()]
    .filter((p) => p.orderCount >= AI_NEW_PRODUCT_MIN_ORDERS && !adSkus.has(p.sku.trim().toLowerCase()))
    .sort((a, b) => b.orderCount - a.orderCount)
    .slice(0, 3);

  return (
    <div className="space-y-4">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg">{toast}</div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex bg-white border border-slate-200 rounded-xl p-1 gap-1">
          {["Shopee", "TikTok Shop"].map((pf) => {
            const pfTheme = PLATFORM_THEME[pf];
            const active = activePlatform === pf;
            return (
              <button
                key={pf}
                onClick={() => switchPlatform(pf)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active ? `${pfTheme.headerBg} text-white` : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${active ? "bg-white/80" : pfTheme.dot}`} />
                {pf}
              </button>
            );
          })}
        </div>
        {/* 店铺选择器 (2026-08-24, new) — real connected stores for this
            platform (same `stores` list Finance/Roles use); only shown when
            there's more than one real store to pick between. */}
        {storesForPlatform.length > 0 && (
          <select
            value={selectedStoreId || ""}
            onChange={(e) => setSelectedStoreId(e.target.value || null)}
            className="text-sm px-3 py-2 border border-slate-200 rounded-lg bg-white"
          >
            <option value="">{t("全部店铺", "All Stores")}</option>
            {storesForPlatform.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* 🤖 AI 广告智能管家 (2026-08-24, new) — gradient AI-styled cards,
          only ever rendered when a real flagged row exists (no "AI found
          nothing so let's show something anyway" filler). */}
      {(stopLossFlags.length > 0 || newProductFlags.length > 0) && (
        <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-purple-50 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-indigo-700">
            <Bot size={16} /> {t("🤖 AI 广告智能管家", "🤖 AI Ad Copilot")}
          </div>
          {stopLossFlags.map((c) => (
            <div key={c.id} className="flex items-start gap-3 bg-white border border-rose-200 rounded-lg p-3">
              <AlertTriangle size={16} className="text-rose-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0 text-xs">
                <div className="font-medium text-slate-700">
                  {t(
                    `止损预警：${c.name} 已投入 RM ${fmt(c.spend)}，ROAS 仅 ${c.roas.toFixed(2)}x（低于目标 ${AD_ROAS_THRESHOLD}x）`,
                    `Stop-loss alert: ${c.name} has spent RM ${fmt(c.spend)}, ROAS only ${c.roas.toFixed(2)}x (below target ${AD_ROAS_THRESHOLD}x)`,
                  )}
                </div>
                <div className="text-slate-400 mt-0.5">{t("建议：暂停投放或大幅降低预算", "Suggestion: pause this campaign or cut its budget significantly")}</div>
              </div>
              <button
                onClick={() => { setAiTarget({ mode: "stop_loss", campaign: c }); setAiNote(""); }}
                className="shrink-0 flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:opacity-90"
              >
                <Zap size={12} /> {t("一键采纳 AI 优化", "Adopt AI Suggestion")}
              </button>
            </div>
          ))}
          {newProductFlags.map((p) => (
            <div key={p.sku} className="flex items-start gap-3 bg-white border border-emerald-200 rounded-lg p-3">
              <Rocket size={16} className="text-emerald-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0 text-xs">
                <div className="font-medium text-slate-700">
                  {t(
                    `潜力商品：${p.name}（${p.sku}）近 ${AI_LOOKBACK_DAYS} 天真实成交 ${p.orderCount} 单，尚未投放广告`,
                    `Potential winner: ${p.name} (${p.sku}) — ${p.orderCount} real orders in the last ${AI_LOOKBACK_DAYS} days, no ads running yet`,
                  )}
                </div>
                <div className="text-slate-400 mt-0.5">{t("建议：开启 GMV Max / 自动出价广告测款", "Suggestion: launch a GMV Max / Auto-Bidding campaign to test it")}</div>
              </div>
              <button
                onClick={() => { setAiTarget({ mode: "new_product", product: p }); setAiNote(""); }}
                className="shrink-0 flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:opacity-90"
              >
                <Zap size={12} /> {t("一键采纳 AI 优化", "Adopt AI Suggestion")}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICardImpl label={t(`${activePlatform} 广告支出 (RM)`, `${activePlatform} Ad Spend (RM)`)} value={fmt(totalSpend)} icon={Megaphone} tone={theme.headerBg} />
        <KPICardImpl label={t("广告带来营收 (RM)", "Ad-Driven Revenue (RM)")} value={fmt(totalRevenue)} icon={TrendingUp} tone="bg-teal-500" />
        <KPICardImpl label="ROAS" value={`${overallRoas.toFixed(2)}x`} sub={t(`有效判定线 ≥ ${AD_ROAS_THRESHOLD}x`, `Effective threshold ≥ ${AD_ROAS_THRESHOLD}x`)} icon={Sparkles} tone="bg-indigo-500" />
        <KPICardImpl label={t("有效广告数", "Effective Ads")} value={`${effectiveCount} / ${rows.length}`} icon={CheckCircle2} tone="bg-emerald-500" />
      </div>

      {/* AI 打广告工具 (2026-08-24, new) — three standalone tools, separate
          from the always-visible stop-loss/新品 cards above. See each
          modal's own comment for what's real vs. template-generated. */}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          onClick={() => setShowCopyGen(true)}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
        >
          <Bot size={14} /> {t("🤖 AI 广告文案与脚本生成器", "🤖 AI Ad Copy & Script Generator")}
        </button>
        <button
          onClick={() => setShowRoasReport(true)}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
        >
          <Sparkles size={14} /> {t("📊 AI ROAS 诊断与风控", "📊 AI ROAS Diagnosis")}
        </button>
        <button
          onClick={() => setShowNegExtractor(true)}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
        >
          <Search size={14} /> {t("🔍 AI 否定词提取助手", "🔍 AI Negative Keyword Extractor")}
        </button>
        <button
          onClick={() => openCreateModal()}
          className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
        >
          <Plus size={14} /> {t("新增广告数据", "Add Campaign")}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-sm font-medium mb-3">{t(`${activePlatform} 各广告支出 vs 带来营收`, `${activePlatform} Ad Spend vs Revenue`)}</div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              {/* dataKey="name" (2026-08-24, was "id") — ad_campaigns.id is
                  now a real uuid (used to be a nice "AD-001" mock string),
                  not fit for a chart label; the campaign name is. */}
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
              <Tooltip />
              <Legend />
              <Bar dataKey="spend" name={t("支出", "Spend")} fill="#f59e0b" radius={[0, 4, 4, 0]} />
              <Bar dataKey="revenue" name={t("带来营收", "Revenue Driven")} fill={theme.dot.includes("orange") ? "#f97316" : "#e11d48"} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className={`rounded-xl border ${theme.border} overflow-hidden bg-white`}>
        <div className={`${theme.headerBg} text-white px-5 py-3 text-sm font-medium`}>{t(`${activePlatform} 广告明细与有效性判定`, `${activePlatform} Ad Detail & Effectiveness`)}</div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
              <th className="py-2 pr-3 pl-5 font-medium">{t("广告", "Campaign")}</th>
              {/* 关联产品 (2026-08-24, new) — real product name/image looked
                  up by SKU from the already-loaded `orders` prop's real
                  order_items (skuInfo map above), not a separate fetch. */}
              <th className="py-2 pr-3 font-medium">{t("关联产品", "Linked Product")}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("支出 (RM)", "Spend (RM)")}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("点击", "Clicks")}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("带来订单数", "Orders")}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("带来营收 (RM)", "Revenue (RM)")}</th>
              <th className="py-2 pr-3 font-medium text-right">ROAS</th>
              <th className="py-2 pr-3 font-medium text-center">{t("判定", "Verdict")}</th>
              <th className="py-2 pr-3 pr-5 font-medium text-right">{t("操作", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="py-6 text-center text-xs text-slate-400">{t("加载中…", "Loading…")}</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} className="py-6 text-center text-xs text-slate-400">{t("该平台暂无广告数据，点击上方「新增广告数据」录入", 'No ad data for this platform yet — click "Add Campaign" above')}</td></tr>
            )}
            {!loading && rows
              .slice()
              .sort((a, b) => b.roas - a.roas)
              .map((c) => {
                const effective = c.roas >= AD_ROAS_THRESHOLD;
                const linked = c.sku ? skuInfo.get(c.sku.trim().toLowerCase()) : null;
                return (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="py-2.5 pr-3 pl-5">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-slate-400">{c.sku || "—"}</div>
                    </td>
                    <td className="py-2.5 pr-3">
                      {linked ? (
                        <div className="flex items-center gap-2 min-w-0">
                          {linked.image ? (
                            <img src={linked.image} alt={linked.name} className="h-8 w-8 rounded-md object-cover border border-slate-200 shrink-0" />
                          ) : (
                            <div className="h-8 w-8 rounded-md bg-slate-100 border border-slate-200 shrink-0" />
                          )}
                          <span className="truncate max-w-[140px] text-xs text-slate-600">{linked.name}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-300">{t("未关联", "Not linked")}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{fmt(c.spend)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{c.clicks}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{c.orders}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{fmt(c.revenue)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-medium">{c.roas.toFixed(2)}x</td>
                    <td className="py-2.5 pr-3 text-center">
                      {c.status === "paused" ? (
                        <span className="text-xs px-2 py-0.5 rounded-full border bg-slate-100 text-slate-500 border-slate-200">{t("已暂停", "Paused")}</span>
                      ) : effective ? (
                        <span className="text-xs px-2 py-0.5 rounded-full border bg-emerald-100 text-emerald-700 border-emerald-200">{t("有效", "Effective")}</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full border bg-rose-100 text-rose-700 border-rose-200">{t("低效", "Ineffective")}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 pr-5 text-right whitespace-nowrap">
                      <button onClick={() => openEditModal(c)} className="text-xs text-slate-500 hover:text-slate-800 mr-2">{t("编辑", "Edit")}</button>
                      <button onClick={() => deleteCampaign(c.id)} className="text-xs text-rose-500 hover:text-rose-700">{t("删除", "Delete")}</button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        </div>
        <div className="text-[11px] text-slate-400 px-5 py-3">
          {t(
            `ROAS（广告投入回报率）= 广告带来营收 ÷ 广告支出。数值 ≥ ${AD_ROAS_THRESHOLD}x 判定为"有效"，低于则建议减少预算或暂停。`,
            `ROAS (Return on Ad Spend) = revenue driven ÷ ad spend. A value ≥ ${AD_ROAS_THRESHOLD}x is judged "Effective"; below that, consider reducing budget or pausing.`,
          )}
        </div>
      </div>

      {/* 新增/编辑广告数据 — every field here is typed in by staff (see the
          data-source note above); there's no ad platform to pull it from. */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-medium">{editingId ? t("编辑广告数据", "Edit Campaign") : t("新增广告数据", "Add Campaign")}</div>
            <div>
              <div className="text-xs text-slate-400 mb-1">{t("平台", "Platform")}</div>
              <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value, platform_account_id: "" })} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg">
                <option value="Shopee">Shopee</option>
                <option value="TikTok Shop">TikTok Shop</option>
              </select>
            </div>
            {/* 店铺 (2026-08-24, new) — real stores for the platform picked
                above; optional (a campaign can stay "全部店铺" if not tied
                to one specific store). */}
            <div>
              <div className="text-xs text-slate-400 mb-1">{t("店铺（可选）", "Store (optional)")}</div>
              <select value={form.platform_account_id} onChange={(e) => setForm({ ...form, platform_account_id: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg">
                <option value="">{t("全部店铺", "All Stores")}</option>
                {(stores || []).filter((s) => s.platform === form.platform).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-xs text-slate-400 mb-1">{t("广告名称", "Campaign Name")}</div>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>
            <div>
              <div className="text-xs text-slate-400 mb-1">{t("关联 SKU（可选）", "Linked SKU (optional)")}</div>
              <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-slate-400 mb-1">{t("支出 (RM)", "Spend (RM)")}</div>
                <input type="number" value={form.spend} onChange={(e) => setForm({ ...form, spend: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div>
                <div className="text-xs text-slate-400 mb-1">{t("带来营收 (RM)", "Revenue (RM)")}</div>
                <input type="number" value={form.revenue} onChange={(e) => setForm({ ...form, revenue: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div>
                <div className="text-xs text-slate-400 mb-1">{t("点击", "Clicks")}</div>
                <input type="number" value={form.clicks} onChange={(e) => setForm({ ...form, clicks: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
              <div>
                <div className="text-xs text-slate-400 mb-1">{t("带来订单", "Orders")}</div>
                <input type="number" value={form.orders} onChange={(e) => setForm({ ...form, orders: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowForm(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">{t("取消", "Cancel")}</button>
              <button onClick={saveForm} className="text-sm px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800">{t("保存", "Save")}</button>
            </div>
          </div>
        </div>
      )}

      {/* 一键采纳 AI 优化 — confirm step, honest about what actually
          happens (see data-source note above the component). */}
      {aiTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setAiTarget(null)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-sm font-medium text-indigo-700"><Bot size={16} /> {t("采纳 AI 优化建议", "Adopt AI Suggestion")}</div>
            <div className="text-xs text-slate-500">
              {aiTarget.mode === "stop_loss"
                ? t(
                    `将「${aiTarget.campaign.name}」标记为已暂停，并记录本次 AI 建议。此操作不会自动调整 TikTok/Shopee 后台的真实广告预算或出价——请在确认后自行到广告后台完成实际暂停/降预算。`,
                    `Marks "${aiTarget.campaign.name}" as paused and logs this AI suggestion. This does NOT change any real budget/bid on TikTok/Shopee — you still need to pause/reduce it in the real ads console yourself.`,
                  )
                : t(
                    `为「${aiTarget.product.name}」建立一条待开启的广告草稿记录（支出/营收先为 RM0）。此操作不会在 TikTok/Shopee 后台真正创建广告——请在确认后自行到广告后台实际开启投放。`,
                    `Creates a draft campaign record for "${aiTarget.product.name}" (spend/revenue start at RM0). This does NOT create a real campaign on TikTok/Shopee — you still need to launch it yourself in the real ads console.`,
                  )}
            </div>
            <div>
              <div className="text-xs text-slate-400 mb-1">{t("备注（可选）", "Note (optional)")}</div>
              <textarea value={aiNote} onChange={(e) => setAiNote(e.target.value)} rows={2} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setAiTarget(null)} className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">{t("取消", "Cancel")}</button>
              <button onClick={confirmAiAction} className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:opacity-90">
                <Zap size={14} /> {t("确认采纳", "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🤖 AI 广告文案与脚本生成器 — see generateAdScripts() comment above
          for exactly how these are produced (template fill, not a real
          external AI call). */}
      {showCopyGen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowCopyGen(false)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-lg space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-sm font-medium text-indigo-700"><Bot size={16} /> {t("🤖 AI 广告文案与脚本生成器", "🤖 AI Ad Copy & Script Generator")}</div>
            <div>
              <div className="text-xs text-slate-400 mb-1">{t("商品名称", "Product Name")}</div>
              <input value={copyForm.productName} onChange={(e) => setCopyForm({ ...copyForm, productName: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" placeholder={t("例：不锈钢保温瓶 750ml", "e.g. Stainless Steel Bottle 750ml")} />
            </div>
            <div>
              <div className="text-xs text-slate-400 mb-1">{t("价格 (RM，可选)", "Price (RM, optional)")}</div>
              <input type="number" value={copyForm.price} onChange={(e) => setCopyForm({ ...copyForm, price: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>
            <div>
              <div className="text-xs text-slate-400 mb-1">{t("语言", "Languages")}</div>
              <div className="flex gap-3">
                {[["zh", "中文"], ["en", "English"], ["ms", "Bahasa Melayu"]].map(([code, label]) => (
                  <label key={code} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input type="checkbox" checked={copyForm.langs[code]} onChange={(e) => setCopyForm({ ...copyForm, langs: { ...copyForm.langs, [code]: e.target.checked } })} className="h-3.5 w-3.5 rounded border-slate-300" />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <button
              onClick={() => setCopyResult(generateAdScripts(copyForm))}
              disabled={!copyForm.productName.trim()}
              className={`flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg text-white ${copyForm.productName.trim() ? "bg-gradient-to-r from-indigo-600 to-purple-600 hover:opacity-90" : "bg-slate-300 cursor-not-allowed"}`}
            >
              <Sparkles size={14} /> {t("生成文案", "Generate")}
            </button>
            {copyResult && copyResult.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                {copyResult.map((r) => (
                  <div key={r.code} className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1">
                    <div className="font-medium text-slate-700">{r.label}</div>
                    <div className="text-slate-600">{r.hook}</div>
                    <div className="text-slate-600">{r.body}</div>
                    <div className="text-slate-600">{r.cta}</div>
                    <button onClick={() => copyText(`${r.hook}\n${r.body}\n${r.cta}`, t("文案已复制", "Copy copied"))} className="text-indigo-600 hover:text-indigo-800 mt-1">{t("复制此文案", "Copy this")}</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end pt-2">
              <button onClick={() => setShowCopyGen(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">{t("关闭", "Close")}</button>
            </div>
          </div>
        </div>
      )}

      {/* 📊 AI ROAS 诊断与风控 — full report across every real row currently
          in view (respects the platform/store filters above), not just the
          worst offenders already surfaced in the always-visible cards. */}
      {showRoasReport && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowRoasReport(false)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-lg space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-sm font-medium text-indigo-700"><Sparkles size={16} /> {t("📊 AI ROAS 诊断与风控", "📊 AI ROAS Diagnosis")}</div>
            <div className="text-xs text-slate-500">
              {t(
                `整体 ROAS ${overallRoas.toFixed(2)}x，共 ${rows.length} 个广告（${effectiveCount} 个有效）`,
                `Overall ROAS ${overallRoas.toFixed(2)}x across ${rows.length} campaigns (${effectiveCount} effective)`,
              )}
            </div>
            <div className="space-y-2">
              {rows.length === 0 && <div className="text-xs text-slate-400">{t("暂无广告数据可诊断", "No campaigns to diagnose yet")}</div>}
              {rows.slice().sort((a, b) => b.roas - a.roas).map((c) => {
                let verdict, advice, tone;
                if (c.status === "paused") {
                  verdict = t("已暂停", "Paused"); advice = t("无需处理", "No action needed"); tone = "text-slate-400";
                } else if (c.spend === 0) {
                  verdict = t("尚未产生花费", "No spend yet"); advice = t("等待数据积累", "Wait for more data"); tone = "text-slate-400";
                } else if (c.roas < AD_ROAS_THRESHOLD) {
                  verdict = t("止损", "Stop-loss"); advice = t("建议暂停或降低预算", "Suggest pausing or cutting budget"); tone = "text-rose-600";
                } else if (c.roas >= AD_ROAS_THRESHOLD * 1.5) {
                  verdict = t("扩量", "Scale up"); advice = t("表现优异，建议加大预算", "Performing well — suggest increasing budget"); tone = "text-emerald-600";
                } else {
                  verdict = t("维持", "Maintain"); advice = t("表现达标，维持现有预算", "On target — keep current budget"); tone = "text-slate-600";
                }
                return (
                  <div key={c.id} className="flex items-center justify-between text-xs border-b border-slate-100 pb-2 last:border-0">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-700 truncate">{c.name}</div>
                      <div className="text-slate-400">{t("ROAS", "ROAS")} {c.roas.toFixed(2)}x · {advice}</div>
                    </div>
                    <div className={`shrink-0 font-medium ${tone}`}>{verdict}</div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={() => setShowRoasReport(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">{t("关闭", "Close")}</button>
            </div>
          </div>
        </div>
      )}

      {/* 🔍 AI 否定词提取助手 — see parseNegativeKeywords() comment above:
          purely parses/filters what staff pastes in, nothing fabricated. */}
      {showNegExtractor && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowNegExtractor(false)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-lg space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-sm font-medium text-indigo-700"><Search size={16} /> {t("🔍 AI 否定词提取助手", "🔍 AI Negative Keyword Extractor")}</div>
            <div className="text-xs text-slate-500">
              {t(
                "粘贴广告后台的搜索词报告，每行一个词，字段用 Tab 或逗号分隔：搜索词, 花费, 点击, 订单。将提取「有花费但 0 订单」的词作为止损候选。",
                "Paste your ads manager's search-term report, one term per line, tab- or comma-separated: term, spend, clicks, orders. Terms with real spend but 0 orders are extracted as negative-keyword candidates.",
              )}
            </div>
            <textarea
              value={negText}
              onChange={(e) => setNegText(e.target.value)}
              rows={6}
              placeholder={"电动车零件,12.50,30,0\n摩托车灯泡,8.20,15,2"}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
            />
            <button
              onClick={() => setNegResult(parseNegativeKeywords(negText))}
              disabled={!negText.trim()}
              className={`flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg text-white ${negText.trim() ? "bg-gradient-to-r from-indigo-600 to-purple-600 hover:opacity-90" : "bg-slate-300 cursor-not-allowed"}`}
            >
              <Search size={14} /> {t("提取否定词", "Extract")}
            </button>
            {negResult && (
              negResult.length === 0 ? (
                <div className="text-xs text-slate-400 pt-2">{t("未发现有花费但 0 订单的词，或格式无法识别", "No spend-but-zero-order terms found, or the format wasn't recognized")}</div>
              ) : (
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <div className="text-xs text-slate-500">{t(`共 ${negResult.length} 个候选否定词`, `${negResult.length} candidate negative keywords`)}</div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {negResult.map((r) => (
                      <div key={r.term} className="flex items-center justify-between text-xs bg-rose-50 border border-rose-100 rounded-lg px-3 py-1.5">
                        <span className="text-slate-700">{r.term}</span>
                        <span className="text-slate-400">RM{fmt(r.spend)} · {r.clicks} {t("点击", "clicks")} · 0 {t("订单", "orders")}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => copyText(negResult.map((r) => r.term).join("\n"), t("否定词已复制", "Negative keywords copied"))} className="text-xs text-indigo-600 hover:text-indigo-800">
                    {t("一键复制全部否定词", "Copy all negative keywords")}
                  </button>
                </div>
              )
            )}
            <div className="flex justify-end pt-2">
              <button onClick={() => setShowNegExtractor(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">{t("关闭", "Close")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================== Print shipping slip (courier-label style, editable) ============================== */

// Seller/sender values come from the order's originating store (system
// settings maintained in 标签设置 → Seller Info), auto-selected by
// order.platformAccountId — never a hardcoded name and never hand-edited at
// print time. Customer/recipient fields (and orderId, the real platform
// order number) are always read straight from the order, never editable,
// anywhere in the print flow — see PLATFORM_LOCKED_FIELDS below.
//
// `sku`/`note` are base values only — PrintSlip's `overrides` state (keyed
// by order.id) may replace them per print run for staff-facing label
// content. This never writes back to order_items/orders; it's a cosmetic,
// per-print-session override only, matching the same pattern as everything
// else on this screen (nothing here persists to the DB).
function labelFields(order, stores) {
  const store = (stores || []).find((s) => s.id === order.platformAccountId);
  return {
    orderId: order.platformOrderId || order.id,
    shipByDate: order.date,
    weight: "",
    senderName: store?.sellerName ?? "",
    senderPhone: store?.sellerPhone ?? "",
    senderAddress: store?.sellerAddress ?? "",
    postcode: "",
    recipientName: order.customer,
    recipientPhone: order.phone,
    recipientAddress: order.address,
    productImage: order.productImage || null,
    sku: order.sku || "",
    note: "",
  };
}

// Platform-synced fields that must never be editable on the print screen,
// regardless of future changes here — recipient identity and the real
// platform order number (orderId is always order.order_no, the same value
// TikTok/Shopee use, never a separate internal id) must stay exactly what
// synced from the platform.
const PLATFORM_LOCKED_FIELDS = ["orderId", "recipientName", "recipientPhone", "recipientAddress"];
const LOCKED_FIELD_LABELS = {
  orderId: { zh: "平台订单号", en: "Platform order no." },
  recipientName: { zh: "收件人", en: "Recipient" },
  recipientPhone: { zh: "收件人电话", en: "Recipient phone" },
  recipientAddress: { zh: "收件地址", en: "Recipient address" },
};

// The only per-print-run editable fields — everything else on the label is
// either locked (see above) or a toggle-only visibility setting.
const OVERRIDABLE_FIELDS = ["sku", "note"];

// Fetches full order_items (image/sku/product name/qty) for the 仓库拣货单
// template — PrintSlip's `orders` prop only carries mapDbOrder's single-item
// summary, so a real picking list needs its own fetch. Self-contained here
// (doesn't touch erp-mvp-demo.jsx's loadRealData/handlePrintConfirm), using
// the same chunk + range() pagination pattern already proven safe past
// Supabase's 1000-row cap.
async function fetchPickingItemsByOrderNo(orderNos) {
  if (!orderNos || orderNos.length === 0) return {};

  const { data: orderRows, error: orderErr } = await supabaseClient
    .from("orders")
    .select("id, order_no")
    .in("order_no", orderNos);
  if (orderErr || !orderRows || orderRows.length === 0) return {};

  const orderNoById = new Map(orderRows.map((o) => [o.id, o.order_no]));
  const ids = orderRows.map((o) => o.id);

  const CHUNK_SIZE = 200;
  const PAGE_SIZE = 1000;
  const chunks = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) chunks.push(ids.slice(i, i + CHUNK_SIZE));

  async function fetchChunk(chunk) {
    const all = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabaseClient
        .from("order_items")
        .select("order_id, sku, product_name, variation, qty, image_url")
        .in("order_id", chunk)
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        console.error("fetchPickingItemsByOrderNo chunk failed", error);
        break;
      }
      all.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return all;
  }

  const results = (await Promise.all(chunks.map(fetchChunk))).flat();
  const byOrderNo = {};
  results.forEach((item) => {
    const orderNo = orderNoById.get(item.order_id);
    if (!orderNo) return;
    (byOrderNo[orderNo] ||= []).push(item);
  });
  return byOrderNo;
}

// `locked` is true when opened from the Orders page (or its drawer) — no
// template switching, no design overrides panel, and ShippingLabelCard
// itself ignores image/sku/customText/note entirely regardless of what's
// configured in 标签设计. Always the plain platform order slip. `locked` is
// false from Label Printing (and Warehouse, which still needs the picking
// template) — full template switching + design overrides, unchanged.
// `initialOverrides` seeds the overrides state — used only when reopening
// this modal to reprint a historical order from 打印记录 (PrintHistoryPanel),
// so the reprint starts pre-filled with whatever sku/note were used last
// time, instead of blank. Normal prints (Orders/Label Printing search) don't
// pass this, so it defaults to empty exactly like before.
export function PrintSlip({ t, orders, stores, onClose, onConfirmPrint, locked = false, initialOverrides = {} }) {
  const [template, setTemplate] = useState("shipping"); // "shipping" | "picking" — locked always stays "shipping"
  const [pickingItemsByOrderNo, setPickingItemsByOrderNo] = useState({});
  const [enabledFieldsByTemplate, setEnabledFieldsByTemplate] = useState({ shipping: null, picking: null }); // null = not loaded yet (show everything)
  const [layoutConfig, setLayoutConfig] = useState({}); // shipping template's size/position config (标签设计) — see LabelDesignPanel
  // Per-print-run label content edits, keyed by order.id — { [orderId]: { sku, note } }.
  // Local component state only, cleared when this modal closes. Never sent
  // to Supabase: this is cosmetic label content, not order/product data, so
  // it deliberately doesn't touch order_items.sku or anything else in the
  // DB. Only OVERRIDABLE_FIELDS keys are ever written here — see the edit
  // panel below, which only exposes inputs for those two fields.
  const [overrides, setOverrides] = useState(() => initialOverrides);
  const lang = t("zh", "en");

  function setOverride(orderId, key, value) {
    if (!OVERRIDABLE_FIELDS.includes(key)) return; // defense in depth — see PLATFORM_LOCKED_FIELDS
    setOverrides((prev) => ({ ...prev, [orderId]: { ...prev[orderId], [key]: value } }));
  }

  function fieldsFor(order) {
    return { ...labelFields(order, stores), ...overrides[order.id] };
  }

  // 仓库拣货单 needs every order_item (not just mapDbOrder's single-item
  // summary), fetched once per batch of orders opened for printing.
  useEffect(() => {
    let cancelled = false;
    fetchPickingItemsByOrderNo(orders.map((o) => o.id)).then((byOrderNo) => {
      if (!cancelled) setPickingItemsByOrderNo(byOrderNo);
    });
    return () => { cancelled = true; };
  }, [orders]);

  // Which optional fields render, and in what order — entirely driven by
  // the admin's 标签设置 choices (label_template_settings.enabled_fields, a
  // Postgres array so element order IS print order). Fetched fresh each
  // time the print preview opens. There is no per-print editing anywhere in
  // this component: Seller info comes from stores (店铺管理/Seller Settings,
  // resolved in labelFields by order.platformAccountId), field visibility/
  // order comes from here, and customer/recipient fields are always read
  // straight from the order — nothing on this screen is user-editable.
  useEffect(() => {
    let cancelled = false;
    supabaseClient
      .from("label_template_settings")
      .select("template_type, enabled_fields, layout_config")
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const byType = {};
        data.forEach((row) => { byType[row.template_type] = row.enabled_fields || []; });
        setEnabledFieldsByTemplate({ shipping: byType.shipping || [], picking: byType.picking || [] });
        const shippingRow = data.find((row) => row.template_type === "shipping");
        setLayoutConfig(shippingRow?.layout_config || {});
      });
    return () => { cancelled = true; };
  }, []);

  const shippingEnabled = enabledFieldsByTemplate.shipping; // ordered array | null
  const pickingEnabled = enabledFieldsByTemplate.picking; // ordered array | null

  // Printing itself — print_count bump, stock deduction, order_status flip,
  // TikTok sync — is entirely owned by onConfirmPrint (handlePrintConfirm in
  // erp-mvp-demo.jsx) and fires the same way no matter which template was
  // visually printed. Nothing here changes that.
  //
  // template_data (→ print_history, one row per order) deliberately excludes
  // recipient PII — order_id already links back to the real order for that.
  // Only the print-specific customization is captured: which template, the
  // resolved sku/note (post-override), and which layout was active. Locked
  // prints just record { template: "shipping", locked: true } since there's
  // no customization to capture.
  function handlePrint() {
    window.print();
    const templateDataByOrderId = {};
    orders.forEach((order) => {
      templateDataByOrderId[order.id] = locked
        ? { template: "shipping", locked: true }
        : template === "shipping"
        ? { template, locked: false, sku: fieldsFor(order).sku, note: fieldsFor(order).note, layoutConfig }
        : { template, locked: false, itemCount: (pickingItemsByOrderNo[order.id] || []).length };
    });
    onConfirmPrint?.(templateDataByOrderId);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl h-[85vh] flex flex-col">
        <div className="no-print flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="text-sm font-medium">
            {t("打印预览", "Print Preview")}{orders.length > 1 ? t(`（共 ${orders.length} 张）`, ` (${orders.length} total)`) : ""}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
            >
              <Printer size={13} /> {t("打印", "Print")}{orders.length > 1 ? t(`全部 ${orders.length} 张`, ` All (${orders.length})`) : ""}
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
        </div>

        {locked ? (
          <div className="no-print flex items-center gap-2 px-5 py-2.5 border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <Printer size={13} /> {t("平台订单打印单", "Platform Order Slip")}
          </div>
        ) : (
          <div className="no-print flex items-center gap-2 px-5 py-2.5 border-b border-slate-200 bg-slate-50">
            <span className="text-[11px] text-slate-400">{t("模板", "Template")}</span>
            <button
              onClick={() => setTemplate("shipping")}
              className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${template === "shipping" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"}`}
            >
              <Printer size={11} /> {t("平台物流面单", "Platform Shipping Label")}
            </button>
            <button
              onClick={() => setTemplate("picking")}
              className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${template === "picking" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"}`}
            >
              <Package size={11} /> {t("仓库拣货单", "Warehouse Picking List")}
            </button>
          </div>
        )}

        {/* Stacked, scrollable preview — every order in the batch renders at
            once (TikTok/Shopee-style continuous print preview), not a
            single "active" card behind a 1/2/3 switcher. Works the same way
            at 3 orders or 100: scroll wheel, no clicking through pages. A
            clear dashed divider separates each order; the print-count
            warning (previously one banner tied to "the active order") is
            now shown per-card, only for orders that actually need it. */}
        <div className="no-print flex-1 overflow-y-auto bg-slate-100 p-4">
          <div className="flex flex-col items-center">
            {orders.map((order, idx) => {
              const orderFields = fieldsFor(order);
              const orderItems = pickingItemsByOrderNo[order.id] || [];
              return (
                <div key={order.id} className="w-full flex flex-col items-center">
                  {idx > 0 && <div className="w-full max-w-2xl my-5 border-t-2 border-dashed border-slate-300" />}
                  <div className="w-full max-w-2xl flex items-center justify-between px-1 mb-2">
                    <span className="text-xs font-medium text-slate-500">#{idx + 1} · {order.id}</span>
                    {order.printCount > 0 && (
                      <span className="flex items-center gap-1 text-[11px] text-amber-700" title={t("请确认是否需要重复打印", "Confirm before printing again")}>
                        <AlertTriangle size={12} className="shrink-0" />
                        {t(`已打印 ${order.printCount} 次`, `Printed ${order.printCount}x`)}
                        {order.lastPrintedAt && (
                          <span className="text-amber-600">
                            {" · "}{new Date(order.lastPrintedAt).toLocaleString(lang === "en" ? "en-MY" : "zh-CN")}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="shadow-sm">
                      {template === "shipping" ? (
                        <ShippingLabelCard t={t} order={order} fields={orderFields} enabledFields={shippingEnabled} layoutConfig={layoutConfig} locked={locked} items={orderItems} pageIndex={idx + 1} pageTotal={orders.length} />
                      ) : (
                        <WarehousePickingCard t={t} order={order} items={orderItems} enabledFields={pickingEnabled} />
                      )}
                    </div>
                    {template === "shipping" && !locked && (
                      <LabelEditPanel
                        t={t}
                        order={order}
                        fields={orderFields}
                        onChange={(key, value) => setOverride(order.id, key, value)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div
          className={`print-slip ${template === "shipping" ? "print-slip-shipping" : "print-slip-picking"}`}
          style={{ position: "absolute", left: "-9999px", top: 0 }}
        >
          {orders.map((order, idx) =>
            template === "shipping" ? (
              <ShippingLabelCard
                key={order.id}
                t={t}
                order={order}
                fields={fieldsFor(order)}
                enabledFields={shippingEnabled}
                layoutConfig={layoutConfig}
                locked={locked}
                items={pickingItemsByOrderNo[order.id] || []}
                pageIndex={idx + 1}
                pageTotal={orders.length}
                isLast={idx === orders.length - 1}
              />
            ) : (
              <WarehousePickingCard
                key={order.id}
                t={t}
                order={order}
                items={pickingItemsByOrderNo[order.id] || []}
                enabledFields={pickingEnabled}
                isLast={idx === orders.length - 1}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

// Per-print editable fields for the active shipping label — SKU and custom
// content only (OVERRIDABLE_FIELDS). Platform-synced fields (recipient
// name/phone/address, the real platform order number) are never rendered
// here at all, on purpose — there's no input for them, so they can't be
// hand-edited from this screen no matter what. Edits are scoped to the
// current PrintSlip session only (see `overrides` in PrintSlip) — nothing
// here is saved to Supabase.
function LabelEditPanel({ t, order, fields, onChange }) {
  return (
    <div className="no-print bg-white border border-slate-200 rounded-lg p-3 w-64 shrink-0 space-y-3">
      <div className="text-xs font-medium text-slate-700">{t("标签内容编辑", "Edit Label Content")}</div>
      <div className="text-[11px] text-slate-400 -mt-2">
        {t("仅影响本次打印，不会修改订单数据", "Only affects this print run — does not change order data")}
      </div>

      <div>
        <label className="text-[11px] text-slate-400 mb-1 block">{t("产品图片", "Product Photo")}</label>
        {fields.productImage ? (
          <img src={fields.productImage} alt={fields.sku || order.product} className="h-16 w-16 object-cover rounded border border-slate-200" />
        ) : (
          <div className="h-16 w-16 rounded border border-dashed border-slate-200 flex items-center justify-center text-[10px] text-slate-300">
            {t("无图片", "No photo")}
          </div>
        )}
      </div>

      <div>
        <label className="text-[11px] text-slate-400 mb-1 block">SKU</label>
        <input
          value={fields.sku}
          onChange={(e) => onChange("sku", e.target.value)}
          placeholder={t("输入 SKU", "Enter SKU")}
          className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-slate-400"
        />
      </div>

      <div>
        <label className="text-[11px] text-slate-400 mb-1 block">{t("自定义标签内容", "Custom Label Content")}</label>
        <textarea
          value={fields.note}
          onChange={(e) => onChange("note", e.target.value)}
          rows={3}
          placeholder={t("在标签上显示的备注文字", "Note text shown on the label")}
          className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-slate-400 resize-none"
        />
      </div>

      {/* Locked, read-only — driven by PLATFORM_LOCKED_FIELDS so this list can
          never drift from what setOverride() actually refuses to touch */}
      <div className="pt-2 border-t border-slate-100 space-y-1">
        <div className="text-[11px] text-slate-400">{t("以下字段与平台同步，不可修改", "Synced from platform — locked")}</div>
        {PLATFORM_LOCKED_FIELDS.map((key) => (
          <div key={key} className="text-[11px] text-slate-500">{LOCKED_FIELD_LABELS[key][t("zh", "en")]}: {fields[key]}</div>
        ))}
      </div>
    </div>
  );
}

function Barcode({ value }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && value) {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        displayValue: true,
        fontSize: 11,
        height: 32,
        margin: 0,
      });
    }
  }, [value]);
  if (!value) return null;
  return <svg ref={ref} style={{ width: "100%" }} />;
}

// enabledFields is the ordered array from label_template_settings (or null
// while loading, treated as "show everything in the default order" so the
// preview never flashes empty). Array position drives render order within
// each section — orderedSubset() picks out just the keys relevant to a
// section, in the admin's chosen order. Customer/recipient fields aren't
// gated by this at all: they're mandatory and always rendered.
// 100mm × 150mm thermal-label layout, structured like a real courier/TikTok
// Shop Seller Centre label: brand strip, courier + tracking barcode, QR +
// Order ID, TO (recipient, prominent), FROM (seller), then a compact SKU
// table. Actual brand/courier logo IMAGES aren't embedded — TikTok's and
// couriers' logos are trademarked assets I can't source or fabricate; the
// `logoUrl` slots below render nothing until real, authorized image files
// are supplied, and fall back to a plain text wordmark so the label still
// works without them.
// Design-only fields — never rendered when locked (Orders-page print),
// regardless of enabledFields/layoutConfig. This is the single point that
// enforces "订单页面打印按钮不进入标签设计": everything else on the card
// (courier/tracking/weight/sender/date) predates the design feature and
// still respects the admin's normal field toggles either way.
const DESIGN_ONLY_FIELDS = ["image", "sku", "customText", "note"];
const IMAGE_SIZE_CLASSES = { small: "h-6 w-6", medium: "h-9 w-9", large: "h-14 w-14" };
const TEXT_SIZE_CLASSES = { small: "text-[9px]", medium: "text-[10px]", large: "text-xs" };

function ShippingLabelCard({ t, order, fields, enabledFields, layoutConfig, locked, items, pageIndex, pageTotal, isLast }) {
  const theme = PLATFORM_THEME[order.platform];
  const trackingValue = order.tracking && order.tracking !== "—" ? order.tracking : fields.orderId;
  const isVisible = (key) => {
    if (locked && DESIGN_ONLY_FIELDS.includes(key)) return false;
    return !enabledFields || enabledFields.includes(key);
  };
  const orderedSubset = (keys) => (enabledFields ? enabledFields.filter((k) => keys.includes(k)) : keys);

  const orderDetailKeys = orderedSubset(["shipByDate", "weight"]);
  const senderKeys = orderedSubset(["senderName", "senderPhone", "senderAddress", "postcode"]);
  // Real brand/courier logo image assets go here once available (e.g. from
  // Supabase Storage or a static import) — left null so nothing is fabricated.
  const platformLogoUrl = null;
  const courierLogoUrl = null;

  // 标签设计's size/position config for image/sku/customText/barcode — see
  // LabelDesignPanel. "position" is one of a fixed set of slots that match
  // this card's actual stacked-section layout (top / productRow / bottom),
  // not free pixel coordinates — the card is sectioned, not a canvas.
  const cfg = layoutConfig || {};
  const imageCfg = cfg.image || {};
  const skuCfg = cfg.sku || {};
  const customTextCfg = cfg.customText || {};
  const barcodePosition = cfg.barcode?.position || "top";

  function renderImageBlock() {
    if (!isVisible("image") || !fields.productImage) return null;
    const sizeClass = IMAGE_SIZE_CLASSES[imageCfg.size] || IMAGE_SIZE_CLASSES.medium;
    return <img key="image" src={fields.productImage} alt={fields.sku} className={`${sizeClass} object-cover rounded border border-slate-200 shrink-0`} />;
  }
  function renderSkuBlock() {
    if (!isVisible("sku") || !fields.sku) return null;
    const sizeClass = TEXT_SIZE_CLASSES[skuCfg.size] || TEXT_SIZE_CLASSES.medium;
    return (
      <div key="sku" className={`${sizeClass} text-slate-600`}>
        <span className="text-slate-400">SKU: </span>
        <span className="font-semibold">{fields.sku}</span>
      </div>
    );
  }
  function renderCustomTextBlock() {
    if (!isVisible("customText") || !customTextCfg.text) return null;
    const sizeClass = TEXT_SIZE_CLASSES[customTextCfg.size] || TEXT_SIZE_CLASSES.medium;
    return <div key="customText" className={`${sizeClass} text-slate-600`}>{customTextCfg.text}</div>;
  }
  // Groups whichever of image/sku/customText are configured for this slot —
  // each element's own `position` decides which slot it lands in, so they
  // don't have to move together even though they can share a slot.
  function renderSlot(slot) {
    const blocks = [
      (imageCfg.position || "productRow") === slot && renderImageBlock(),
      (skuCfg.position || "productRow") === slot && renderSkuBlock(),
      (customTextCfg.position || "bottom") === slot && renderCustomTextBlock(),
    ].filter(Boolean);
    if (blocks.length === 0) return null;
    return <div className="flex items-center gap-2 border border-slate-300 mb-1.5 px-2 py-1.5">{blocks}</div>;
  }

  function renderSenderRow(key) {
    if (key === "senderName") return <div key={key} className="font-semibold">{fields.senderName || "—"}</div>;
    if (key === "senderPhone") return fields.senderPhone ? <div key={key} className="text-[10px] text-slate-600">{fields.senderPhone}</div> : null;
    if (key === "senderAddress") return <div key={key} className="text-[10px] text-slate-600 leading-snug">{fields.senderAddress || "—"}</div>;
    if (key === "postcode") return <div key={key} className="text-[10px] text-slate-400">{t("邮编", "Postcode")}: {fields.postcode || "—"}</div>;
    return null;
  }

  return (
    <div
      className="bg-white p-3 text-[11px] flex flex-col"
      style={{ width: "100mm", minHeight: "150mm", ...( !isLast ? { breakAfter: "page" } : {}) }}
    >
      {/* Brand strip */}
      <div className="flex items-center justify-between border-b-2 border-slate-900 pb-1.5 mb-1.5">
        {platformLogoUrl ? (
          <img src={platformLogoUrl} alt={order.platform} className="h-6" />
        ) : (
          <span className={`text-base font-extrabold ${theme.text}`}>{order.platform}</span>
        )}
        <div className="flex items-center gap-1.5">
          {/* Batch-print page number, e.g. "Page 2/5" — helps warehouse staff
              match a printed sheet back to its place in a multi-order batch. */}
          {pageTotal > 1 && (
            <span className="text-[10px] font-medium text-slate-500">{t(`第 ${pageIndex}/${pageTotal} 张`, `Page ${pageIndex}/${pageTotal}`)}</span>
          )}
          {/* Payment method — same top-right corner the old COD-only badge
              lived in (matches the reference label's badge cluster next to
              the courier logo). Reads straight from orders.is_cod, the only
              payment-related field that actually exists — there is no
              payment_method column, so non-COD orders show a generic
              "Online Payment" label, not a specific method (that data was
              never synced from the platform). Print display only. */}
          <div className="flex flex-col items-end leading-tight">
            <span className="text-[9px] text-slate-400">{t("付款方式 Payment", "Payment Method")}:</span>
            <span className={`text-[10px] font-bold ${order.isCod ? "text-rose-600" : "text-slate-700"}`}>
              {order.isCod ? "COD" : t("线上支付 Online Payment", "Online Payment")}
            </span>
          </div>
        </div>
      </div>

      {/* "top" slot — image/SKU/customText configured to render here (标签设计) */}
      {renderSlot("top")}

      {/* Courier + tracking barcode — barcode itself moves to the "bottom"
          block below if 条码位置/barcodePosition is "bottom"; locked prints
          always keep it here regardless of layoutConfig */}
      <div className="border border-slate-300 mb-1.5 px-2 py-1.5">
        <div className="flex items-center justify-between mb-1">
          {courierLogoUrl ? (
            <img src={courierLogoUrl} alt={order.courier} className="h-4" />
          ) : (
            <span className="text-[11px] font-bold">{order.courier}</span>
          )}
          {isVisible("weight") && <span className="text-[10px] text-slate-500">{fields.weight ? `${fields.weight} kg` : ""}</span>}
        </div>
        {(locked || barcodePosition === "top") && (
          <>
            <Barcode value={trackingValue} />
            <div className="text-center text-[10px] text-slate-500 tracking-wide">{trackingValue}</div>
          </>
        )}
      </div>

      {/* TO — recipient, always shown, never editable/locked to the order */}
      <div className="border border-slate-900 mb-1.5">
        <div className="text-[10px] font-bold text-white bg-slate-900 px-2 py-0.5">{t("收件人 TO (Penerima)", "TO (Penerima)")}</div>
        <div className="px-2 py-1.5">
          <div className="text-sm font-bold">{fields.recipientName}</div>
          <div className="text-xs font-medium">{fields.recipientPhone}</div>
          <div className="text-xs text-slate-700 leading-snug">{fields.recipientAddress}</div>
        </div>
      </div>

      {/* FROM — seller, auto-selected by the order's originating store */}
      {senderKeys.length > 0 && (
        <div className="border border-slate-300 mb-1.5">
          <div className="text-[10px] font-semibold text-slate-500 px-2 py-0.5 bg-slate-50 border-b border-slate-300">
            {t("寄件人 FROM (Pengirim)", "FROM (Pengirim)")}
          </div>
          <div className="px-2 py-1.5 space-y-0.5">
            {senderKeys.map(renderSenderRow)}
          </div>
        </div>
      )}

      {/* "productRow" slot — image/sku/customText default here (design mode only) */}
      {renderSlot("productRow")}

      {/* QR — order ID text always shows here, locked or not (reverted back
          to how it always worked; the standalone PICK LIST block that used
          to move this text away has been removed per the real TikTok Shop
          reference the user provided — see the product table below, which
          replaces it at the bottom of the card instead). */}
      <div className="flex items-center justify-between border border-slate-300 px-2 py-1.5 mb-1.5">
        <div>
          <div className="text-[10px] text-slate-400">{t("订单编号 Order ID", "Order ID")}</div>
          <div className="text-xs font-bold">{fields.orderId}</div>
          {isVisible("shipByDate") && fields.shipByDate && (
            <div className="text-[10px] text-slate-400 mt-0.5">{t("发货日期", "Ship By")}: {fields.shipByDate}</div>
          )}
        </div>
        <QRCodeSVG value={fields.orderId} size={40} />
      </div>

      {isVisible("note") && fields.note && (
        <div className="text-[10px] text-slate-500 mb-1">{fields.note}</div>
      )}

      {/* "bottom" slot — image/sku/customText configured to render here */}
      {renderSlot("bottom")}

      {!locked && barcodePosition === "bottom" && (
        <div className="border border-slate-300 mb-1.5 px-2 py-1.5">
          <Barcode value={trackingValue} />
          <div className="text-center text-[10px] text-slate-500 tracking-wide">{trackingValue}</div>
        </div>
      )}

      {/* Product table — locked (平台订单打印单) only, restored to the bottom of
          the card to match the real TikTok Shop label's own layout (product
          details sit below Sender/Receiver/barcode, not mid-card). Columns
          mirror the reference photo exactly: Product Name | SKU | Seller SKU
          | Qty. TikTok's "SKU" column there is actually the variant label
          (e.g. "MATT RED") and "Seller SKU" is the merchant's real SKU code
          (e.g. "SGV-VISOREX/MATT-RED") — order_items already has both as
          separate columns (variation / sku), so this maps directly with no
          new field and no schema change, just selecting `variation` too
          (fetchPickingItemsByOrderNo). Read-only, no image column — image
          stays a design-only field, untouched by this. */}
      {locked && items && items.length > 0 && (
        <div className="border border-slate-900 mb-1.5">
          <table className="w-full text-[9px] border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white">
                <td className="px-1.5 py-1 font-semibold">Product Name</td>
                <td className="px-1.5 py-1 font-semibold border-l border-slate-700">SKU</td>
                <td className="px-1.5 py-1 font-semibold border-l border-slate-700">Seller SKU</td>
                <td className="px-1.5 py-1 font-semibold border-l border-slate-700 text-right">Qty</td>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-slate-300">
                  <td className="px-1.5 py-1 align-top">{it.product_name || "—"}</td>
                  <td className="px-1.5 py-1 align-top border-l border-slate-200">{it.variation || "—"}</td>
                  <td className="px-1.5 py-1 align-top border-l border-slate-200">{it.sku || "—"}</td>
                  <td className="px-1.5 py-1 align-top border-l border-slate-200 text-right">{it.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-auto pt-1.5 border-t border-dashed border-slate-300 text-[9px] text-slate-400 text-center">
        {t("出货前请扫描追踪号码确认", "Scan tracking number to confirm before shipping")}
      </div>
    </div>
  );
}

// 仓库拣货单 — internal picking list, not shown to the courier: product
// photo/SKU/name/qty for every item on the order, no sender/recipient/price
// info. Sourced from real order_items (fetchPickingItemsByOrderNo), not the
// single-item summary the rest of the app uses for list display.
function WarehousePickingCard({ t, order, items, enabledFields, isLast }) {
  const theme = PLATFORM_THEME[order.platform];
  const COL_DEFS = {
    image: { key: "image", label: t("图片", "Photo"), className: "text-left font-semibold py-1.5 px-2 w-12" },
    sku: { key: "sku", label: "SKU", className: "text-left font-semibold py-1.5 px-2" },
    productName: { key: "productName", label: t("产品名称", "Product Name"), className: "text-left font-semibold py-1.5 px-2" },
    qty: { key: "qty", label: "Qty", className: "text-right font-semibold py-1.5 px-2 w-12" },
  };
  // Column order follows the admin's 标签设置 order (array position),
  // falling back to the default image/sku/productName/qty order while
  // settings are still loading.
  const cols = (enabledFields || ["image", "sku", "productName", "qty"])
    .map((key) => COL_DEFS[key])
    .filter(Boolean);

  function renderCell(item, key) {
    if (key === "image") {
      return item.image_url ? (
        <img src={item.image_url} alt={item.sku} className="h-9 w-9 object-cover rounded border border-slate-200" />
      ) : (
        <div className="h-9 w-9 rounded border border-slate-200 bg-slate-50" />
      );
    }
    if (key === "sku") return item.sku || t("（无SKU）", "(no SKU)");
    if (key === "productName") return item.product_name || "—";
    if (key === "qty") return item.qty;
    return null;
  }

  return (
    <div
      className="w-[380px] bg-white p-4 text-sm"
      style={!isLast ? { breakAfter: "page", borderBottom: "2px dashed #e2e8f0" } : undefined}
    >
      <div className="border-b-2 border-slate-900 pb-2 mb-3 flex items-center justify-between">
        <span className={`text-lg font-bold ${theme.text}`}>{order.platform}</span>
        <span className="text-xs text-slate-500">{t("仓库拣货单", "Warehouse Picking List")}</span>
      </div>
      <div className="text-xs text-slate-500 mb-3">{t("订单编号", "Order No.")}: {order.platformOrderId || order.id}</div>

      <div className="border border-slate-300">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-300 text-slate-500">
              {cols.map((c) => <th key={c.key} className={c.className}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={cols.length || 1} className="py-3 px-2 text-center text-slate-400">{t("无商品数据", "No item data")}</td>
              </tr>
            )}
            {items.map((item, i) => (
              <tr key={`${item.sku}-${i}`} className="border-b border-slate-200 last:border-0">
                {cols.map((c) => (
                  <td key={c.key} className={`py-1.5 px-2 ${c.key === "qty" ? "text-right font-semibold" : c.key === "sku" ? "font-medium" : c.key === "productName" ? "text-slate-600" : ""}`}>
                    {renderCell(item, c.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 pt-2 border-t border-dashed border-slate-300 text-[10px] text-slate-400 text-center">
        {t("仓库内部使用 · 请逐项核对SKU与数量后交付包装", "For internal warehouse use · Verify each SKU and quantity before handing off to packing")}
      </div>
    </div>
  );
}
