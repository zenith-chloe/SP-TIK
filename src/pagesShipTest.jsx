import React, { useState } from "react";
import { AlertTriangle, Search, Send, RefreshCw } from "lucide-react";
import { supabaseClient } from "./shared.jsx";

// Standalone TikTok "Ship Package" API test tool. Deliberately isolated from
// every other page: its own component, its own state, no shared hooks with
// Orders/Order Management Center, no read/write of the `orders` table. Talks
// only to the separate tiktok-ship-package-test Edge Function (which itself
// never touches orders/platform_sync_progress/last_synced_at).
export function ShipPackageTest({ t }) {
  const [orderNo, setOrderNo] = useState("");
  const [lookupState, setLookupState] = useState({ status: "idle" }); // idle|loading|found|notfound|error
  const [lookupResult, setLookupResult] = useState(null);
  const [shippingProviderId, setShippingProviderId] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [shipState, setShipState] = useState({ status: "idle" }); // idle|loading|done|error
  const [shipResult, setShipResult] = useState(null);

  async function handleLookup() {
    if (!orderNo.trim()) return;
    setLookupState({ status: "loading" });
    setShipResult(null);
    setShipState({ status: "idle" });
    const { data, error } = await supabaseClient.functions.invoke("tiktok-ship-package-test", {
      body: { action: "lookup", orderNo: orderNo.trim() },
    });
    if (error) {
      setLookupState({ status: "error", message: error.message || t("查询失败", "Lookup failed") });
      return;
    }
    if (!data?.found) {
      setLookupState({ status: "notfound" });
      setLookupResult(null);
      return;
    }
    console.log("LOOKUP DATA", data);
    setLookupResult(data);
    setShippingProviderId(data.shippingProviderId || "");
    setLookupState({ status: "found" });
  }

  function handleShipClick() {
    setConfirming(true);
  }

  async function handleConfirmShip() {
    setConfirming(false);
    setShipState({ status: "loading" });
    const { data, error } = await supabaseClient.functions.invoke("tiktok-ship-package-test", {
      body: {
        action: "ship",
        orderNo: lookupResult.orderNo,
        packageId: lookupResult.packageId,
        shippingProviderId,
        trackingNumber: trackingNumber.trim(),
      },
    });
    if (error) {
      setShipState({ status: "error", message: error.message || t("调用失败", "Call failed") });
      return;
    }
    setShipResult(data);
    setShipState({ status: "done" });
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 text-xs text-amber-800">
        <AlertTriangle size={15} className="shrink-0 mt-0.5" />
        <div>
          {t(
            "内部测试工具：只影响你输入的这一笔TikTok订单，不改动订单同步/自动状态计算/其他ERP页面。点击「确认发货」会真实调用TikTok API，操作不可逆，请谨慎选择测试订单。",
            "Internal test tool: only affects the single TikTok order you enter here — does not touch order sync, status calculation, or any other ERP page. Clicking \"Confirm Ship\" makes a real, irreversible TikTok API call — choose your test order carefully.",
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-700">{t("1. 查询订单", "1. Look up order")}</div>
        <div className="flex gap-2">
          <input
            value={orderNo}
            onChange={(e) => setOrderNo(e.target.value)}
            placeholder={t("输入TikTok订单号", "Enter TikTok order_no")}
            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-slate-300"
          />
          <button
            onClick={handleLookup}
            disabled={lookupState.status === "loading" || !orderNo.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-slate-900 text-white disabled:opacity-40"
          >
            {lookupState.status === "loading" ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
            {t("查询", "Look up")}
          </button>
        </div>

        {lookupState.status === "error" && (
          <div className="text-xs text-red-600">{lookupState.message}</div>
        )}
        {lookupState.status === "notfound" && (
          <div className="text-xs text-slate-500">
            {t("最近页面没有找到这个订单号（只扫描最近约250笔）。", "Order not found in the recent pages scanned (~250 most recent orders).")}
          </div>
        )}
        {lookupState.status === "found" && lookupResult && (
          <div className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 space-y-1">
            {console.log("RENDER lookupResult", lookupResult)}
            <div>{t("买家", "Buyer")}: {lookupResult.buyerName ?? "—"}</div>
            <div>{t("当前状态", "Current status")}: <span className="font-semibold">{lookupResult.status}</span></div>
            <div>{t("金额", "Amount")}: {lookupResult.totalAmount ?? "—"}</div>
            <div>package_id: {lookupResult.packageId ?? <span className="text-red-600">{t("未找到，无法发货", "not found — cannot ship")}</span>}</div>
            <div>shipping_provider: {lookupResult.shippingProviderName ?? "—"} ({lookupResult.shippingProviderId ?? "—"})</div>
          </div>
        )}
      </div>

      {lookupState.status === "found" && lookupResult?.packageId && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="text-sm font-semibold text-slate-700">{t("2. 填写发货信息", "2. Fill in ship details")}</div>
          <div>
            <label className="text-xs text-slate-500">shipping_provider_id</label>
            <input
              value={shippingProviderId}
              onChange={(e) => setShippingProviderId(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">{t("测试运单号", "Test tracking number")}</label>
            <input
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="TEST123456789"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none mt-1"
            />
          </div>

          {!confirming ? (
            <button
              onClick={handleShipClick}
              disabled={!shippingProviderId.trim() || !trackingNumber.trim() || shipState.status === "loading"}
              className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-red-600 text-white disabled:opacity-40"
            >
              <Send size={14} /> {t("发货测试", "Test ship")}
            </button>
          ) : (
            <div className="border border-red-200 bg-red-50 rounded-lg p-3 space-y-2">
              <div className="text-xs text-red-700 font-medium">
                {t(
                  `确认要对订单 ${lookupResult.orderNo} 调用真实TikTok发货API吗？这会真实改变TikTok平台上的订单状态，无法撤销。`,
                  `Really call the real TikTok ship API for order ${lookupResult.orderNo}? This will really change the order's status on TikTok — cannot be undone.`,
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={handleConfirmShip} className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white">
                  {t("确认发货", "Confirm ship")}
                </button>
                <button onClick={() => setConfirming(false)} className="px-3 py-1.5 text-xs rounded-lg border border-slate-200">
                  {t("取消", "Cancel")}
                </button>
              </div>
            </div>
          )}

          {shipState.status === "loading" && <div className="text-xs text-slate-500">{t("调用中…", "Calling…")}</div>}
          {shipState.status === "error" && <div className="text-xs text-red-600">{shipState.message}</div>}
          {shipState.status === "done" && shipResult && (
            <div className={`text-xs rounded-lg p-3 space-y-1 ${shipResult.success ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
              <div className="font-semibold">{shipResult.success ? t("调用成功", "Call succeeded") : t("调用失败", "Call failed")}</div>
              <div>code: {shipResult.code} · message: {shipResult.message || "—"}</div>
              <div>{t("调用后订单状态", "Order status after call")}: {shipResult.resultOrderStatus ?? "—"}</div>
              <div className="text-[10px] text-slate-500 break-all">{JSON.stringify(shipResult.data)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
