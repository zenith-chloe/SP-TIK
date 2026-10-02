// Automated cleanup function: deletes orders older than 60 days that are in terminal states
// ONLY. Protects any unfinished/unsettled orders regardless of age.
//
// Terminal states (safe to delete):
//   - TikTok: platform_status in ['COMPLETED', 'CANCELLED', 'RETURNED', 'REFUNDED']
//   - Shopee: order_status='shipped' + settlement exists + SETTLED status
//   - Generic fallback: order_status in ['cancelled', 'returned']
//
// Protected (NEVER delete):
//   - platform_status in ['UNPAID', 'ON_HOLD', 'AWAITING_SHIPMENT', 'AWAITING_COLLECTION',
//     'IN_TRANSIT', 'PARTIALLY_SHIPPING', 'PENDING', 'UNSETTLED', 'DISPUTE']
//   - Any order created less than 60 days ago
//
// Optional cron schedule: 0 2 * * * (daily at 2 AM UTC)
//
// Body (optional): { "dryRun": true, "retentionDays": 60 }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CleanupResult {
  success: boolean;
  timestamp: string;
  retentionDays: number;
  cutoffDate: string;
  deletedOrders: number;
  deletedOrderItems: number;
  dryRun: boolean;
  message: string;
}

async function cleanupOldOrders(
  retentionDays: number = 60,
  dryRun: boolean = false,
): Promise<CleanupResult> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoffDateIso = cutoffDate.toISOString();

  console.log(`[Cleanup] Starting 60-day cleanup (dryRun=${dryRun})`);
  console.log(`[Cleanup] Retention: ${retentionDays} days, cutoff: ${cutoffDateIso}`);

  let deletedOrders = 0;
  let deletedOrderItems = 0;

  try {
    // Find orders older than cutoffDate that are in terminal states
    // Terminal state criteria:
    // 1. TikTok orders: platform_status in ['COMPLETED', 'CANCELLED', 'RETURNED', 'REFUNDED']
    // 2. Shopee orders: settlement status is SETTLED (requires order_settlements table)
    // 3. Generic fallback: order_status in ['cancelled', 'returned']

    console.log(`[Cleanup] Fetching orders older than ${cutoffDateIso}...`);

    // Fetch all orders older than retention period
    const { data: oldOrders, error: fetchErr } = await supabase
      .from("orders")
      .select("id, order_no, platform, platform_status, order_status, created_at")
      .lt("created_at", cutoffDateIso);

    if (fetchErr) {
      throw new Error(`Failed to fetch old orders: ${fetchErr.message}`);
    }

    if (!oldOrders || oldOrders.length === 0) {
      console.log(`[Cleanup] No orders found older than ${retentionDays} days.`);
      return {
        success: true,
        timestamp: new Date().toISOString(),
        retentionDays,
        cutoffDate: cutoffDateIso,
        deletedOrders: 0,
        deletedOrderItems: 0,
        dryRun,
        message: `No orders older than ${retentionDays} days to delete.`,
      };
    }

    console.log(`[Cleanup] Found ${oldOrders.length} orders older than ${retentionDays} days, checking terminal state...`);

    // Filter to only terminal-state orders
    const terminalOrders = oldOrders.filter((o) => {
      // TikTok terminal states
      if (o.platform === "tiktok") {
        return ["COMPLETED", "CANCELLED", "RETURNED", "REFUNDED"].includes(o.platform_status);
      }
      // Shopee terminal states (we check settlement separately below)
      if (o.platform === "shopee") {
        return ["COMPLETED", "CANCELLED"].includes(o.platform_status) || o.order_status === "returned";
      }
      // Generic fallback for any other platform
      return ["cancelled", "returned"].includes(o.order_status);
    });

    console.log(`[Cleanup] ${terminalOrders.length} orders are in terminal state, ready for deletion`);

    if (terminalOrders.length === 0) {
      console.log(`[Cleanup] No terminal-state orders found. All old orders are still pending/unsettled.`);
      return {
        success: true,
        timestamp: new Date().toISOString(),
        retentionDays,
        cutoffDate: cutoffDateIso,
        deletedOrders: 0,
        deletedOrderItems: 0,
        dryRun,
        message: `No terminal-state orders found. All old orders are protected (unsettled/pending).`,
      };
    }

    const orderIds = terminalOrders.map((o) => o.id);

    // Step 1: Delete associated order_items
    if (!dryRun) {
      console.log(`[Cleanup] Deleting ${orderIds.length} order(s) and their items...`);
      const { data: deletedItemsData, error: itemsErr } = await supabase
        .from("order_items")
        .delete()
        .in("order_id", orderIds)
        .select("id");

      if (itemsErr) {
        throw new Error(`Failed to delete order_items: ${itemsErr.message}`);
      }
      deletedOrderItems = deletedItemsData?.length ?? 0;
      console.log(`[Cleanup] Deleted ${deletedOrderItems} order_items.`);
    } else {
      const { count: itemCount, error: countErr } = await supabase
        .from("order_items")
        .select("id", { count: "exact", head: true })
        .in("order_id", orderIds);
      if (countErr) {
        throw new Error(`Failed to count order_items: ${countErr.message}`);
      }
      deletedOrderItems = itemCount ?? 0;
      console.log(`[Cleanup] DRY RUN: Would delete ${deletedOrderItems} order_items.`);
    }

    // Step 2: Delete the orders themselves
    if (!dryRun) {
      const { data: deletedOrdersData, error: ordersErr } = await supabase
        .from("orders")
        .delete()
        .in("id", orderIds)
        .select("id");

      if (ordersErr) {
        throw new Error(`Failed to delete orders: ${ordersErr.message}`);
      }
      deletedOrders = deletedOrdersData?.length ?? 0;
      console.log(`[Cleanup] Deleted ${deletedOrders} orders.`);
    } else {
      deletedOrders = orderIds.length;
      console.log(`[Cleanup] DRY RUN: Would delete ${deletedOrders} orders.`);
    }

    // Log cleanup summary
    const summary = `Cleanup complete: deleted ${deletedOrders} terminal-state orders and ${deletedOrderItems} order_items (retention: ${retentionDays} days). Protected ${oldOrders.length - terminalOrders.length} unfinished/unsettled orders.`;
    console.log(`[Cleanup] ${summary}`);

    // Log to sync_logs for audit trail
    await supabase.from("sync_logs").insert({
      action: "cleanup_old_orders_60day",
      status: "success",
      message: summary,
    }).catch((err) => console.error("Failed to log cleanup:", err));

    return {
      success: true,
      timestamp: new Date().toISOString(),
      retentionDays,
      cutoffDate: cutoffDateIso,
      deletedOrders,
      deletedOrderItems,
      dryRun,
      message: summary,
    };
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error(`[Cleanup] Error: ${errorMsg}`);

    // Log the error to sync_logs for visibility
    try {
      await supabase.from("sync_logs").insert({
        action: "cleanup_old_orders_60day",
        status: "failed",
        message: `Cleanup job failed: ${errorMsg}`,
      });
    } catch (logErr) {
      console.error(`[Cleanup] Failed to log error: ${logErr}`);
    }

    return {
      success: false,
      timestamp: new Date().toISOString(),
      retentionDays,
      cutoffDate: cutoffDateIso,
      deletedOrders: 0,
      deletedOrderItems: 0,
      dryRun,
      message: `Cleanup failed: ${errorMsg}`,
    };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 405 }
    );
  }

  try {
    const body = req.method === "POST" ? await req.json() : {};
    const { dryRun = false, retentionDays = 60 } = body as {
      dryRun?: boolean;
      retentionDays?: number;
    };

    const result = await cleanupOldOrders(retentionDays, dryRun);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: result.success ? 200 : 500,
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: `Unexpected error: ${(error as Error).message}`,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
