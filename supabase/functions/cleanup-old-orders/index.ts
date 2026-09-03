// Automated cleanup function: deletes orders older than 60 days if they are
// completed (order_status = 'completed'). Keeps any orders (completed or not)
// that are younger than 60 days. Also cleans up old sync_logs and other
// historical records to manage Supabase storage within the free tier limit
// (5M rows).
//
// This is an admin-only edge function, typically invoked by a cron job.
// Runs once daily at 2 AM UTC.
//
// Body (optional): { "dryRun": true, "retentionDays": 60 }
// - dryRun: if true, only reports what would be deleted without actually
//   deleting anything (useful for testing/preview)
// - retentionDays: override default 60-day retention window
//
// Required secrets: none (uses SUPABASE_SERVICE_ROLE_KEY in env)

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
  deletedSyncLogs: number;
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

  console.log(`[Cleanup] Starting cleanup job (dryRun=${dryRun})`);
  console.log(`[Cleanup] Retention: ${retentionDays} days`);
  console.log(`[Cleanup] Cutoff date: ${cutoffDateIso}`);

  let deletedOrders = 0;
  let deletedOrderItems = 0;
  let deletedSyncLogs = 0;
  let errorMsg = "";

  try {
    // Step 1: Find all completed orders older than cutoffDate
    console.log(`[Cleanup] Step 1: Fetching completed orders older than ${cutoffDateIso}...`);
    const { data: oldOrders, error: fetchErr } = await supabase
      .from("orders")
      .select("id")
      .eq("order_status", "completed")
      .lt("created_at", cutoffDateIso);

    if (fetchErr) {
      throw new Error(`Failed to fetch old orders: ${fetchErr.message}`);
    }

    if (!oldOrders || oldOrders.length === 0) {
      console.log(`[Cleanup] No completed orders found older than ${retentionDays} days.`);
      return {
        success: true,
        timestamp: new Date().toISOString(),
        retentionDays,
        cutoffDate: cutoffDateIso,
        deletedOrders: 0,
        deletedOrderItems: 0,
        deletedSyncLogs: 0,
        dryRun,
        message: `No completed orders older than ${retentionDays} days to delete.`,
      };
    }

    console.log(`[Cleanup] Found ${oldOrders.length} completed orders to delete.`);
    const orderIds = oldOrders.map((o) => o.id);

    // Step 2: Delete associated order_items
    if (!dryRun) {
      console.log(`[Cleanup] Step 2: Deleting associated order_items...`);
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
      // Dry run: just count
      const { count, error: countErr } = await supabase
        .from("order_items")
        .select("id", { count: "exact", head: true })
        .in("order_id", orderIds);
      if (countErr) {
        throw new Error(`Failed to count order_items: ${countErr.message}`);
      }
      deletedOrderItems = count ?? 0;
      console.log(`[Cleanup] DRY RUN: Would delete ${deletedOrderItems} order_items.`);
    }

    // Step 3: Delete the orders themselves
    if (!dryRun) {
      console.log(`[Cleanup] Step 3: Deleting orders...`);
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

    // Step 4: Delete old sync_logs (keep only last 60 days)
    if (!dryRun) {
      console.log(`[Cleanup] Step 4: Deleting old sync_logs...`);
      const { data: deletedLogsData, error: logsErr } = await supabase
        .from("sync_logs")
        .delete()
        .lt("created_at", cutoffDateIso)
        .select("id");

      if (logsErr) {
        throw new Error(`Failed to delete sync_logs: ${logsErr.message}`);
      }
      deletedSyncLogs = deletedLogsData?.length ?? 0;
      console.log(`[Cleanup] Deleted ${deletedSyncLogs} sync_logs.`);
    } else {
      const { count, error: countErr } = await supabase
        .from("sync_logs")
        .select("id", { count: "exact", head: true })
        .lt("created_at", cutoffDateIso);
      if (countErr) {
        throw new Error(`Failed to count sync_logs: ${countErr.message}`);
      }
      deletedSyncLogs = count ?? 0;
      console.log(`[Cleanup] DRY RUN: Would delete ${deletedSyncLogs} sync_logs.`);
    }

    // Log cleanup summary
    const summary = `Cleanup complete: deleted ${deletedOrders} orders, ${deletedOrderItems} order_items, ${deletedSyncLogs} sync_logs (retention: ${retentionDays} days)`;
    console.log(`[Cleanup] ${summary}`);

    return {
      success: true,
      timestamp: new Date().toISOString(),
      retentionDays,
      cutoffDate: cutoffDateIso,
      deletedOrders,
      deletedOrderItems,
      deletedSyncLogs,
      dryRun,
      message: summary,
    };
  } catch (error) {
    errorMsg = (error as Error).message;
    console.error(`[Cleanup] Error: ${errorMsg}`);

    // Log the error to sync_logs for visibility
    try {
      await supabase.from("sync_logs").insert({
        action: "cleanup_old_orders",
        status: "failed",
        message: `Cleanup job failed: ${errorMsg}`,
      });
    } catch (logErr) {
      console.error(`[Cleanup] Failed to log error to sync_logs: ${logErr}`);
    }

    return {
      success: false,
      timestamp: new Date().toISOString(),
      retentionDays,
      cutoffDate: cutoffDateIso,
      deletedOrders,
      deletedOrderItems,
      deletedSyncLogs,
      dryRun,
      message: `Cleanup failed: ${errorMsg}`,
    };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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
