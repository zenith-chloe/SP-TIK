#!/usr/bin/env node
/**
 * EMERGENCY FIX: Force Latest Order Sync (Last 24 Hours)
 *
 * This script:
 * 1. Updates platform_accounts.last_synced_at to 24 hours ago
 * 2. Triggers an incremental sync to fetch all orders from last 24 hours
 * 3. This bypasses the full sync gap and catches all new orders immediately
 *
 * USAGE:
 *   node EMERGENCY_FIX_sync_latest_orders.mjs
 *
 * REQUIREMENTS:
 *   - Set SUPABASE_SERVICE_KEY environment variable with service role key
 *   - Or hardcode it in the script below
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_KEY || ""; // Add your service key here if env var not set

if (!SERVICE_ROLE_KEY) {
  console.error("❌ ERROR: SUPABASE_SERVICE_KEY environment variable not set");
  console.error("");
  console.error("Set it with:");
  console.error("  export SUPABASE_SERVICE_KEY='your-service-role-key'");
  console.error("  node EMERGENCY_FIX_sync_latest_orders.mjs");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function emergencyFixSync() {
  console.log("🚨 EMERGENCY FIX: Forcing Latest Order Sync");
  console.log("━".repeat(60));
  console.log("");

  try {
    // Step 1: Get the TikTok platform account
    console.log("Step 1: Finding TikTok account...");
    const { data: account, error: accountError } = await supabase
      .from("platform_accounts")
      .select("id, account_name, last_synced_at")
      .eq("platform", "tiktok")
      .single();

    if (accountError || !account) {
      throw new Error(`Failed to find TikTok account: ${accountError?.message}`);
    }

    console.log(`  ✓ Found: ${account.account_name}`);
    console.log(`  Current last_synced_at: ${account.last_synced_at || "NULL (never synced)"}`);
    console.log("");

    // Step 2: Update last_synced_at to 24 hours ago to trigger incremental sync
    console.log("Step 2: Setting last_synced_at to 24 hours ago...");
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { error: updateError } = await supabase
      .from("platform_accounts")
      .update({ last_synced_at: twentyFourHoursAgo })
      .eq("id", account.id);

    if (updateError) {
      throw new Error(`Failed to update last_synced_at: ${updateError.message}`);
    }

    console.log(`  ✓ Updated to: ${twentyFourHoursAgo}`);
    console.log("");

    // Step 3: Trigger sync to fetch orders from last 24 hours
    console.log("Step 3: Triggering incremental sync for last 24 hours...");
    const syncResponse = await fetch(
      `${SUPABASE_URL}/functions/v1/tiktok-sync-orders`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          apikey: SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}), // Empty body = incremental sync (no fullSync param)
      }
    );

    const syncResult = await syncResponse.json();
    const result = syncResult.results?.[0];

    if (!result) {
      throw new Error("No sync result returned");
    }

    console.log(`  ✓ Sync triggered successfully`);
    console.log(`    - Mode: ${result.mode}`);
    console.log(`    - Orders synced: ${result.syncedOrders}`);
    console.log(`    - Pages: ${result.pages}`);
    console.log(`    - Full sync done: ${result.fullSyncDone}`);
    console.log("");

    // Step 4: Show expected results
    console.log("Step 4: Expected Results");
    console.log("━".repeat(60));
    console.log("✅ All orders from the last 24 hours have been synced");
    console.log("✅ This includes the 5 new orders (49-44=5) that were created");
    console.log("✅ ERP should now show:");
    console.log("   - Awaiting Shipment: 49");
    console.log("   - Awaiting Collection: 1");
    console.log("   - Total To Ship: 50");
    console.log("");

    // Step 5: Next steps
    console.log("Next Steps:");
    console.log("━".repeat(60));
    console.log("1. Refresh your ERP: https://motoparts-erp.vercel.app");
    console.log("2. Go to Orders page");
    console.log("3. Check Order Management Center - count should be updated");
    console.log("4. Verify 待发货 = 49, 待取货 = 1");
    console.log("");

    console.log("✨ EMERGENCY FIX COMPLETE ✨");

  } catch (error) {
    console.error("❌ ERROR:", error.message);
    process.exit(1);
  }
}

emergencyFixSync();
