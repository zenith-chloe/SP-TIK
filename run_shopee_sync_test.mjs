#!/usr/bin/env -S deno run --allow-env --allow-net

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
);

console.log("========================================");
console.log("SHOPEE SYNC TEST - Real Sync Execution");
console.log("========================================\n");

// Get Shopee account
const { data: accounts } = await supabase
  .from("platform_accounts")
  .select("id, shop_id, platform, status, access_token")
  .eq("platform", "shopee")
  .eq("status", "connected");

if (!accounts || accounts.length === 0) {
  console.log("❌ ERROR: No connected Shopee account found");
  Deno.exit(1);
}

const account = accounts[0];
console.log(`Connected to Shopee shop: ${account.shop_id}`);
console.log(`Account ID: ${account.id}`);
console.log(`Has access token: ${!!account.access_token}\n`);

// Count READY_TO_SHIP BEFORE
const { data: beforeOrders, count: beforeCount } = await supabase
  .from("orders")
  .select("id, order_no, platform_status", { count: "exact" })
  .eq("platform", "shopee")
  .eq("platform_status", "READY_TO_SHIP");

console.log(`📊 BEFORE SYNC:`);
console.log(`   ERP Shopee READY_TO_SHIP: ${beforeCount || 0}`);
if (beforeOrders && beforeOrders.length > 0) {
  console.log(`   Sample: ${beforeOrders.slice(0, 3).map(o => o.order_no).join(", ")}`);
}
console.log();

// Clear old sync logs
await supabase
  .from("sync_logs")
  .delete()
  .ilike("action", "%shopee%");

// Run the sync
console.log(`🔄 Running shopee-sync-orders function...`);
const startTime = Date.now();

let syncResult;
try {
  const response = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/shopee-sync-orders`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({}),
    }
  );

  const elapsed = Date.now() - startTime;
  console.log(`   HTTP Status: ${response.status}`);
  console.log(`   Response time: ${elapsed}ms`);

  const text = await response.text();
  try {
    syncResult = JSON.parse(text);
    console.log(`   ✅ Valid JSON response\n`);
  } catch (e) {
    console.log(`   ❌ Invalid JSON response`);
    console.log(`   First 300 chars: ${text.slice(0, 300)}\n`);
  }
} catch (e) {
  console.log(`   ❌ ERROR: ${e.message}\n`);
}

// Wait for DB writes
console.log(`⏳ Waiting for sync to complete...`);
await new Promise(resolve => setTimeout(resolve, 2000));

// Analyze sync logs
console.log(`\n📋 SYNC LOGS (detailed):`);
console.log("-".repeat(80));

const { data: logs } = await supabase
  .from("sync_logs")
  .select("*")
  .ilike("action", "%shopee%")
  .order("created_at", { ascending: false });

let stats = {
  total_logs: 0,
  success_count: 0,
  failed_count: 0,
  warning_count: 0,
  skipped_count: 0,
  batch_0_returned: 0,
  retry_issues: 0,
  orders_api_errors: 0,
};

if (logs && logs.length > 0) {
  logs.forEach((log, i) => {
    stats.total_logs++;

    if (log.status === "success") stats.success_count++;
    else if (log.status === "failed") stats.failed_count++;
    else if (log.status === "warning") stats.warning_count++;
    else if (log.status === "skipped") stats.skipped_count++;

    if (log.message?.includes("returned 0 results")) stats.batch_0_returned++;
    if (log.message?.includes("after 3 retries")) stats.retry_issues++;
    if (log.message?.includes("missing order_sn")) stats.orders_api_errors++;

    console.log(`\n[${i + 1}] ${log.created_at.split("T")[1]}`);
    console.log(`    Action: ${log.action}`);
    console.log(`    Status: ${log.status}`);
    console.log(`    Message: ${log.message?.substring(0, 150)}${log.message?.length > 150 ? "..." : ""}`);
  });
} else {
  console.log("(No sync logs found)");
}

// Count READY_TO_SHIP AFTER
const { data: afterOrders, count: afterCount } = await supabase
  .from("orders")
  .select("id, order_no, platform_status")
  .eq("platform", "shopee")
  .eq("platform_status", "READY_TO_SHIP");

console.log(`\n${"=".repeat(80)}`);
console.log(`📊 AFTER SYNC:`);
console.log(`   ERP Shopee READY_TO_SHIP: ${afterCount || 0}`);
if (afterOrders && afterOrders.length > 0) {
  console.log(`   Sample: ${afterOrders.slice(0, 3).map(o => o.order_no).join(", ")}`);
}

// Check sync_progress
const { data: progress } = await supabase
  .from("platform_sync_progress")
  .select("*")
  .eq("account_id", account.id);

console.log(`\n📈 SYNC PROGRESS:`);
if (progress && progress.length > 0) {
  const p = progress[0];
  console.log(`   Status: ${p.status}`);
  console.log(`   Orders synced (this run): ${p.orders_synced || 0}`);
  console.log(`   Pages fetched: ${p.pages_fetched || 0}`);
  if (p.last_error) {
    console.log(`   Last error: ${p.last_error}`);
  }
}

// Get all Shopee orders (any status)
const { count: totalShopeeOrders } = await supabase
  .from("orders")
  .select("id", { count: "exact" })
  .eq("platform", "shopee");

console.log(`\n📊 OVERALL STATISTICS:`);
console.log(`   Total Shopee orders in ERP: ${totalShopeeOrders || 0}`);
console.log(`   READY_TO_SHIP before: ${beforeCount || 0}`);
console.log(`   READY_TO_SHIP after: ${afterCount || 0}`);
console.log(`   Change: ${(afterCount || 0) - (beforeCount || 0)}`);

console.log(`\n📋 SYNC LOG STATISTICS:`);
console.log(`   Total logs: ${stats.total_logs}`);
console.log(`   Success: ${stats.success_count}`);
console.log(`   Failed: ${stats.failed_count}`);
console.log(`   Warning: ${stats.warning_count}`);
console.log(`   Skipped: ${stats.skipped_count}`);
console.log(`   Batches returning 0 results: ${stats.batch_0_returned}`);
console.log(`   Retry failures: ${stats.retry_issues}`);
console.log(`   Order missing order_sn: ${stats.orders_api_errors}`);

console.log(`\n${"=".repeat(80)}`);
console.log("✅ TEST COMPLETE");
console.log(`\n🎯 SUMMARY:`);
console.log(`   Shopee API: ? orders found`);
console.log(`   Get order detail success: ? orders`);
console.log(`   Get order detail failed: ? orders`);
console.log(`   ERP new/updated: ${(afterCount || 0) - (beforeCount || 0)} orders`);
console.log();
