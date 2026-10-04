// AutoCount Sync Service — the single shared core both the manual "同步到
// AutoCount" button AND the future automatic sync queue call into. Neither
// caller talks to AutoCount directly; both go through syncOrderToAutoCount()
// below, which itself only ever talks to AutoCount through ./adapter.ts.
//
//   Manual Sync ─┐
//                ├─> syncOrderToAutoCount() ─> adapter.ts ─> AutoCount API
//   Automatic  ──┘         (this file)         (not connected yet)
//
// Body:
//   { orderNo, platform }  — sync one specific order (manual button)
//   { mode: "queue" }      — sync every eligible not-yet-synced order
//                            (the future automatic-sync entrypoint; nothing
//                            calls this on a schedule yet — see the cron
//                            note at the bottom of this file)
//
// Never writes to Shopee/TikTok order data, products, or inventory. Only
// ever touches orders.autocount_doc_no / orders.autocount_sync_status (both
// already existed before this feature) and sync_logs (existing table,
// already used by every other sync function in this project for exactly
// this purpose — order_id + action + status + message + created_at).
//
// Required secrets: SYNC_TRIGGER_SECRET (same auth-gate convention as every
// other sync function here). Does NOT require any AutoCount secret yet —
// there isn't one.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.45.4";
import { getConnection, createSalesOrderAndDO, type AutoCountConnection } from "./adapter.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Batch cap for queue mode — same defensive-cap spirit as every other sync
// function's per-invocation limit in this project. Irrelevant until a real
// cron actually calls mode:"queue", but the entrypoint is built now so the
// UI/manual path and the future automatic path are provably the same code.
const QUEUE_BATCH_SIZE = 50;

export interface SyncOutcome {
  orderNo: string;
  result: "synced" | "already_synced" | "incomplete" | "not_connected" | "failed" | "not_found";
  message: string;
  documentNo?: string | null;
}

// The ONE core routine — manual and automatic sync both call exactly this,
// nothing else. See the module comment above.
async function syncOrderToAutoCount(orderNo: string, platform: string): Promise<SyncOutcome> {
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, order_no, platform, buyer_name, shipping_address, order_status, autocount_sync_status, autocount_doc_no")
    .eq("order_no", orderNo)
    .eq("platform", platform)
    .maybeSingle();

  if (orderErr || !order) {
    return { orderNo, result: "not_found", message: `找不到订单 ${orderNo}` };
  }

  // Duplicate protection (required, section 7) — a SYNCED order is never
  // re-sent, manual or automatic, with no exception until a real "重新同步"
  // feature exists (not built).
  if (order.autocount_sync_status === "synced") {
    return {
      orderNo,
      result: "already_synced",
      message: "此订单已经同步到 AutoCount",
      documentNo: order.autocount_doc_no,
    };
  }

  // Order-completeness check (required, section 3) — before anything else,
  // independent of whether AutoCount is even connected.
  const { data: items } = await supabase
    .from("order_items")
    .select("sku, product_name, qty, unit_price")
    .eq("order_id", order.id);
  const missing: string[] = [];
  if (!order.buyer_name) missing.push("buyer_name");
  if (!order.shipping_address) missing.push("shipping_address");
  if (!items || items.length === 0) missing.push("order_items");
  if (missing.length > 0) {
    const message = `订单资料不完整，缺少：${missing.join(", ")}`;
    await supabase.from("sync_logs").insert({
      order_id: order.id, action: "autocount_sync", status: "failed", message,
    });
    return { orderNo, result: "incomplete", message };
  }

  const connection: AutoCountConnection = await getConnection(supabase);

  if (!connection.connected) {
    const message = connection.reason || "AutoCount 尚未连接";
    await supabase.from("sync_logs").insert({
      order_id: order.id, action: "autocount_sync", status: "failed", message,
    });
    // Reuses the existing 'failed' value (orders.autocount_sync_status
    // already only allows pending/synced/failed) — "not connected" is
    // surfaced through the sync_logs message, not a new DB enum value.
    await supabase.from("orders").update({ autocount_sync_status: "failed" }).eq("id", order.id);
    return { orderNo, result: "not_connected", message };
  }

  // Real integration point — unreachable today (getConnection() never
  // returns connected:true until the real handshake is implemented in
  // adapter.ts), kept here so the full intended flow is visible and no UI/
  // caller code needs to change once it does become reachable.
  const outcome = await createSalesOrderAndDO(connection, {
    orderNo: order.order_no,
    platform: order.platform,
    buyerName: order.buyer_name,
    shippingAddress: order.shipping_address,
    items: (items || []).map((it: { sku: string; product_name: string; qty: number; unit_price: number }) => ({
      sku: it.sku, qty: it.qty, unitPrice: Number(it.unit_price || 0), productName: it.product_name,
    })),
  });

  if (outcome.success && outcome.documentNo) {
    await supabase.from("orders").update({
      autocount_sync_status: "synced",
      autocount_doc_no: outcome.documentNo,
    }).eq("id", order.id);
    await supabase.from("sync_logs").insert({
      order_id: order.id, action: "autocount_sync", status: "success",
      message: `AutoCount DO created: ${outcome.documentNo}`,
    });
    return { orderNo, result: "synced", message: "已同步到 AutoCount", documentNo: outcome.documentNo };
  }

  const message = outcome.error || "AutoCount 同步失败";
  await supabase.from("orders").update({ autocount_sync_status: "failed" }).eq("id", order.id);
  await supabase.from("sync_logs").insert({
    order_id: order.id, action: "autocount_sync", status: "failed", message,
  });
  return { orderNo, result: "failed", message };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth gate: identical pattern to every other sync function in this
  // project (shopee-sync-orders/shopee-sync-returns/etc).
  function jwtRole(authHeader: string | null): string | undefined {
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    const payload = token?.split(".")[1];
    if (!payload) return undefined;
    try {
      return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")))?.role;
    } catch {
      return undefined;
    }
  }
  const role = jwtRole(req.headers.get("Authorization"));
  const requiredSecret = Deno.env.get("SYNC_TRIGGER_SECRET");
  let authorized: boolean;
  if (role === "authenticated") {
    authorized = true;
  } else if (role === "anon") {
    authorized = !!requiredSecret && req.headers.get("x-sync-secret") === requiredSecret;
  } else {
    authorized = false;
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { orderNo?: string; platform?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Queue mode — the future automatic-sync entrypoint. Not called by any
  // cron today (see section 10: no cron is created until AutoCount is
  // actually connected, so this never runs on a schedule yet). Calling it
  // manually/on-demand right now just proves it shares the same core as
  // the single-order path — every result will be "not_connected".
  if (body.mode === "queue") {
    const { data: candidates, error } = await supabase
      .from("orders")
      .select("order_no, platform")
      .in("platform", ["shopee", "tiktok"])
      .neq("autocount_sync_status", "synced")
      .neq("order_status", "cancelled")
      .gt("print_count", 0)
      .order("updated_at", { ascending: true })
      .limit(QUEUE_BATCH_SIZE);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: SyncOutcome[] = [];
    for (const c of candidates || []) {
      results.push(await syncOrderToAutoCount(c.order_no, c.platform));
    }
    return new Response(JSON.stringify({ mode: "queue", count: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Manual single-order sync — the "同步到 AutoCount" button.
  if (!body.orderNo || !body.platform) {
    return new Response(JSON.stringify({ error: "Missing orderNo/platform" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const outcome = await syncOrderToAutoCount(body.orderNo, body.platform);
  return new Response(JSON.stringify(outcome), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
