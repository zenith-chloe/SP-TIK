import { useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Info, TrendingUp,
  DollarSign, Sparkles, Bot, Send, Users, Megaphone, Printer, X,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  PRODUCTS, PLATFORM_THEME, ROLES, AD_CAMPAIGNS, AD_ROAS_THRESHOLD,
  profit, fmt, statusLabel, warehouseLabel,
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

export function Finance({ t, orders }) {
  const byPlatform = ["Shopee", "TikTok Shop"].map((pl) => {
    const os = orders.filter((o) => o.platform === pl && o.status !== "已取消");
    const revenue = os.reduce((s, o) => s + o.unitPrice * o.qty, 0);
    const fees = os.reduce((s, o) => s + o.platformFee + o.commission, 0);
    const cost = os.reduce((s, o) => s + o.cost * o.qty, 0);
    const netProfit = os.reduce((s, o) => s + profit(o), 0);
    return { platform: pl, revenue, fees, cost, netProfit };
  });

  const totalProfit = byPlatform.reduce((s, p) => s + p.netProfit, 0);
  const totalRevenue = byPlatform.reduce((s, p) => s + p.revenue, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICardImpl label={t("总营收 (RM)", "Total Revenue (RM)")} value={fmt(totalRevenue)} icon={TrendingUp} tone="bg-teal-500" />
        <KPICardImpl label={t("平台费用+佣金 (RM)", "Platform Fees + Commission (RM)")} value={fmt(byPlatform.reduce((s, p) => s + p.fees, 0))} icon={DollarSign} tone="bg-amber-500" />
        <KPICardImpl label={t("净利润 (RM)", "Net Profit (RM)")} value={fmt(totalProfit)} icon={TrendingUp} tone="bg-indigo-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-sm font-medium mb-3">{t("按平台利润拆分", "Profit Breakdown by Platform")}</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byPlatform}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="platform" tick={{ fontSize: 12 }} />
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
          <div className="text-sm font-medium mb-3">{t("平台明细", "Platform Detail")}</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                <th className="py-2 font-medium">{t("平台", "Platform")}</th>
                <th className="py-2 font-medium text-right">{t("营收", "Revenue")}</th>
                <th className="py-2 font-medium text-right">{t("成本", "Cost")}</th>
                <th className="py-2 font-medium text-right">{t("净利润", "Net Profit")}</th>
              </tr>
            </thead>
            <tbody>
              {byPlatform.map((p) => (
                <tr key={p.platform} className="border-b border-slate-100 last:border-0">
                  <td className="py-2.5">{p.platform}</td>
                  <td className="py-2.5 text-right tabular-nums">{fmt(p.revenue)}</td>
                  <td className="py-2.5 text-right tabular-nums">{fmt(p.cost)}</td>
                  <td className="py-2.5 text-right tabular-nums font-medium text-emerald-600">{fmt(p.netProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-sm font-medium mb-3">{t("订单级利润明细（前 10 笔）", "Order-Level Profit Detail (First 10)")}</div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
              <th className="py-2 pr-3 font-medium">{t("订单编号", "Order No.")}</th>
              <th className="py-2 pr-3 font-medium">{t("平台", "Platform")}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("商品金额", "Product Amount")}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("费用+佣金", "Fees + Commission")}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("净利润", "Net Profit")}</th>
            </tr>
          </thead>
          <tbody>
            {orders.slice(0, 10).map((o) => {
              const p = profit(o);
              return (
                <tr key={o.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2.5 pr-3 font-medium">{o.id}</td>
                  <td className="py-2.5 pr-3">{o.platform}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{fmt(o.unitPrice * o.qty)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{fmt(o.platformFee + o.commission)}</td>
                  <td className={`py-2.5 pr-3 text-right tabular-nums font-medium ${p >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(p)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
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

const ROLE_EN = { 管理员: "Admin", 运营专员: "Operations", 仓管: "Warehouse", 财务: "Finance", 客服: "Customer Service" };
const MODULE_EN = { 订单: "Orders", 库存: "Inventory", 财务: "Finance", AI: "AI", 权限: "Roles" };

export function Roles({ t }) {
  const modules = ["订单", "库存", "财务", "AI", "权限"];
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-1.5 text-sm font-medium mb-3"><Users size={14} className="text-slate-500"/> {t("角色与权限矩阵", "Roles & Permissions Matrix")}</div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[500px]">
        <thead>
          <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
            <th className="py-2 pr-3 font-medium">{t("角色", "Role")}</th>
            <th className="py-2 pr-3 font-medium">{t("用户数", "Users")}</th>
            {modules.map((m) => (<th key={m} className="py-2 pr-3 font-medium text-center">{t(m, MODULE_EN[m] || m)}</th>))}
          </tr>
        </thead>
        <tbody>
          {ROLES.map((r) => (
            <tr key={r.role} className="border-b border-slate-100 last:border-0">
              <td className="py-2.5 pr-3 font-medium">{t(r.role, ROLE_EN[r.role] || r.role)}</td>
              <td className="py-2.5 pr-3 tabular-nums text-slate-500">{r.users}</td>
              {modules.map((m) => (
                <td key={m} className="py-2.5 pr-3 text-center">
                  {r.perms[m] ? <CheckCircle2 size={15} className="text-emerald-500 inline" /> : <span className="text-slate-200">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

/* ============================== Ads spend (广告费用) ============================== */

export function AdsSpend({ t }) {
  const [activePlatform, setActivePlatform] = useState("Shopee");
  const theme = PLATFORM_THEME[activePlatform];

  const allRows = AD_CAMPAIGNS.map((c) => ({ ...c, roas: c.revenue / c.spend }));
  const rows = allRows.filter((c) => c.platform === activePlatform);

  const totalSpend = rows.reduce((s, c) => s + c.spend, 0);
  const totalRevenue = rows.reduce((s, c) => s + c.revenue, 0);
  const overallRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const effectiveCount = rows.filter((c) => c.roas >= AD_ROAS_THRESHOLD).length;

  return (
    <div className="space-y-4">
      <div className="inline-flex bg-white border border-slate-200 rounded-xl p-1 gap-1">
        {["Shopee", "TikTok Shop"].map((pf) => {
          const pfTheme = PLATFORM_THEME[pf];
          const active = activePlatform === pf;
          return (
            <button
              key={pf}
              onClick={() => setActivePlatform(pf)}
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICardImpl label={t(`${activePlatform} 广告支出 (RM)`, `${activePlatform} Ad Spend (RM)`)} value={fmt(totalSpend)} icon={Megaphone} tone={theme.headerBg} />
        <KPICardImpl label={t("广告带来营收 (RM)", "Ad-Driven Revenue (RM)")} value={fmt(totalRevenue)} icon={TrendingUp} tone="bg-teal-500" />
        <KPICardImpl label="ROAS" value={`${overallRoas.toFixed(2)}x`} sub={t(`有效判定线 ≥ ${AD_ROAS_THRESHOLD}x`, `Effective threshold ≥ ${AD_ROAS_THRESHOLD}x`)} icon={Sparkles} tone="bg-indigo-500" />
        <KPICardImpl label={t("有效广告数", "Effective Ads")} value={`${effectiveCount} / ${rows.length}`} icon={CheckCircle2} tone="bg-emerald-500" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-sm font-medium mb-3">{t(`${activePlatform} 各广告支出 vs 带来营收`, `${activePlatform} Ad Spend vs Revenue`)}</div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="id" tick={{ fontSize: 11 }} width={60} />
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
              <th className="py-2 pr-3 pl-5 font-medium">{t("广告 / 商品", "Ad / Product")}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("支出 (RM)", "Spend (RM)")}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("点击", "Clicks")}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("带来订单", "Orders")}</th>
              <th className="py-2 pr-3 font-medium text-right">{t("带来营收 (RM)", "Revenue (RM)")}</th>
              <th className="py-2 pr-3 font-medium text-right">ROAS</th>
              <th className="py-2 pr-3 pr-5 font-medium text-center">{t("判定", "Verdict")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="py-6 text-center text-xs text-slate-400">{t("该平台暂无广告数据", "No ad data for this platform yet")}</td></tr>
            )}
            {rows
              .slice()
              .sort((a, b) => b.roas - a.roas)
              .map((c) => {
                const effective = c.roas >= AD_ROAS_THRESHOLD;
                return (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="py-2.5 pr-3 pl-5">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-slate-400">{c.sku}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{fmt(c.spend)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{c.clicks}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{c.orders}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{fmt(c.revenue)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums font-medium">{c.roas.toFixed(2)}x</td>
                    <td className="py-2.5 pr-3 pr-5 text-center">
                      {effective ? (
                        <span className="text-xs px-2 py-0.5 rounded-full border bg-emerald-100 text-emerald-700 border-emerald-200">{t("有效", "Effective")}</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full border bg-rose-100 text-rose-700 border-rose-200">{t("低效", "Ineffective")}</span>
                      )}
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
    </div>
  );
}

/* ============================== Print shipping slip (courier-label style, editable) ============================== */

const LABEL_FIELD_DEFS = [
  { key: "shipByDate", zh: "发货日期", en: "Ship By Date", type: "date" },
  { key: "weight", zh: "重量 (kg)", en: "Weight (kg)", type: "text" },
  { key: "senderName", zh: "寄件人", en: "Sender Name", type: "text" },
  { key: "senderAddress", zh: "寄件地址", en: "Sender Address", type: "textarea" },
  { key: "postcode", zh: "邮编", en: "Postcode", type: "text" },
  { key: "recipientName", zh: "收件人", en: "Recipient Name", type: "text" },
  { key: "recipientPhone", zh: "收件人电话", en: "Recipient Phone", type: "text" },
  { key: "recipientAddress", zh: "收件地址", en: "Recipient Address", type: "textarea" },
  { key: "note", zh: "备注", en: "Note", type: "text" },
];

function labelFields(order, overrides) {
  const o = overrides[order.id] || {};
  return {
    orderId: order.platformOrderId || order.id,
    shipByDate: o.shipByDate ?? order.date,
    weight: o.weight ?? "",
    senderName: o.senderName ?? "",
    senderAddress: o.senderAddress ?? "",
    postcode: o.postcode ?? "",
    recipientName: o.recipientName ?? order.customer,
    recipientPhone: o.recipientPhone ?? order.phone,
    recipientAddress: o.recipientAddress ?? order.address,
    note: o.note ?? "",
  };
}

export function PrintSlip({ t, orders, onClose, onConfirmPrint }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [overrides, setOverrides] = useState({});
  const lang = t("zh", "en");

  function updateField(orderId, key, value) {
    setOverrides((prev) => ({ ...prev, [orderId]: { ...(prev[orderId] || {}), [key]: value } }));
  }

  function handlePrint() {
    window.print();
    onConfirmPrint?.();
  }

  const activeOrder = orders[activeIdx] || orders[0];
  const activeFields = labelFields(activeOrder, overrides);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl h-[85vh] flex flex-col">
        <div className="no-print flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="text-sm font-medium">
            {t("发货单预览", "Shipping Label Preview")}{orders.length > 1 ? t(`（共 ${orders.length} 张）`, ` (${orders.length} total)`) : ""}
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

        <div className="no-print flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-y-auto bg-slate-100 p-4 flex flex-col items-center gap-3">
            {orders.length > 1 && (
              <div className="flex gap-1.5 flex-wrap justify-center">
                {orders.map((o, i) => (
                  <button
                    key={o.id}
                    onClick={() => setActiveIdx(i)}
                    className={`text-[11px] px-2.5 py-1 rounded-full border ${i === activeIdx ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200"}`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            )}
            <div className="shadow-sm">
              <ShippingLabelCard t={t} order={activeOrder} fields={activeFields} />
            </div>
          </div>
          <div className="w-72 shrink-0 border-l border-slate-200 overflow-y-auto p-4 space-y-3">
            <div className="text-xs font-medium text-slate-500">{t("编辑标签内容", "Edit label")}</div>
            {LABEL_FIELD_DEFS.map((f) => (
              <div key={f.key}>
                <label className="text-[11px] text-slate-400 mb-1 block">{lang === "en" ? f.en : f.zh}</label>
                {f.type === "textarea" ? (
                  <textarea
                    value={activeFields[f.key]}
                    onChange={(e) => updateField(activeOrder.id, f.key, e.target.value)}
                    rows={2}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-slate-400 resize-none"
                  />
                ) : (
                  <input
                    type={f.type === "date" ? "date" : "text"}
                    value={activeFields[f.key]}
                    onChange={(e) => updateField(activeOrder.id, f.key, e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-slate-400"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="print-slip" style={{ position: "absolute", left: "-9999px", top: 0 }}>
          {orders.map((order, idx) => (
            <ShippingLabelCard
              key={order.id}
              t={t}
              order={order}
              fields={labelFields(order, overrides)}
              isLast={idx === orders.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ShippingLabelCard({ t, order, fields, isLast }) {
  const theme = PLATFORM_THEME[order.platform];
  const lang = t("zh", "en");
  return (
    <div
      className="w-[380px] bg-white p-4 text-sm"
      style={!isLast ? { breakAfter: "page", borderBottom: "2px dashed #e2e8f0" } : undefined}
    >
      <div className="flex items-center gap-3 border-b-2 border-slate-900 pb-2 mb-3">
        <span className={`text-lg font-bold shrink-0 ${theme.text}`}>{order.platform}</span>
        <div
          className="flex-1 h-8"
          style={{ backgroundImage: "repeating-linear-gradient(90deg, #0f172a 0 2px, transparent 2px 5px)" }}
        />
      </div>

      <div className="text-[11px] font-semibold text-slate-500 mb-1">{t("订单信息 Order Details", "Order Details")}</div>
      <table className="w-full text-xs mb-3">
        <tbody>
          <tr>
            <td className="py-0.5 text-slate-400 w-28">{t("发货日期 Ship By", "Ship By Date")}</td>
            <td className="py-0.5 font-medium">{fields.shipByDate || "—"}</td>
          </tr>
          <tr>
            <td className="py-0.5 text-slate-400">{t("重量 Weight(kg)", "Weight(kg)")}</td>
            <td className="py-0.5 font-medium">{fields.weight || "—"}</td>
          </tr>
          <tr>
            <td className="py-0.5 text-slate-400">{t("订单编号 Order ID", "Order ID")}</td>
            <td className="py-0.5 font-medium">{fields.orderId}</td>
          </tr>
        </tbody>
      </table>

      <div className="text-[11px] font-semibold text-slate-500 mb-1">{t("寄件人 Sender Details (Pengirim)", "Sender Details (Pengirim)")}</div>
      <div className="text-xs font-medium mb-0.5">{fields.senderName || "—"}</div>
      <div className="text-xs text-slate-600 mb-1 leading-relaxed">{fields.senderAddress || "—"}</div>
      <div className="text-[11px] text-slate-400 mb-3">{t("邮编", "Postcode")}: {fields.postcode || "—"}</div>

      <div className="text-[11px] font-semibold text-slate-500 mb-1">{t("收件人 Recipient Details (Penerima)", "Recipient Details (Penerima)")}</div>
      <div className="text-xs font-medium">{fields.recipientName}</div>
      <div className="text-xs text-slate-600">{fields.recipientPhone}</div>
      <div className="text-xs text-slate-600 leading-relaxed">{fields.recipientAddress}</div>

      <div className="mt-3 pt-2 border-t border-slate-200 flex items-center justify-between text-xs">
        <span className="text-slate-500">{order.sku} · {order.product} × {order.qty}</span>
        <span className="font-semibold tabular-nums">RM {fmt(order.unitPrice * order.qty + order.shippingFee)}</span>
      </div>
      {fields.note && (
        <div className="mt-2 text-[11px] text-slate-500">{fields.note}</div>
      )}

      <div className="mt-3 pt-2 border-t border-dashed border-slate-300 text-[10px] text-slate-400 text-center">
        {t("请核对商品与数量后封箱 · 出货前请扫描追踪号码确认", "Please verify product and quantity before sealing · Scan tracking number before shipping")}
      </div>
    </div>
  );
}
