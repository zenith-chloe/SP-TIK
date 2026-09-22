import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
);

console.log("=".repeat(80));
console.log("SHOPEE SYNC VERIFICATION - Real Sync Test");
console.log("=".repeat(80));

// Step 1: Get current Shopee READY_TO_SHIP order count in ERP
console.log("\n[STEP 1] Current ERP Status:");
console.log("-".repeat(80));

const { data: currentOrders, error: queryErr } = await supabase
  .from("orders")
  .select("id, order_no, platform, platform_status, updated_at", { count: "exact" })
  .eq("platform", "shopee")
  .eq("platform_status", "READY_TO_SHIP");

const erpReadyToShipBefore = currentOrders?.length || 0;
console.log(`ERP Shopee READY_TO_SHIP orders BEFORE sync: ${erpReadyToShipBefore}`);
if (currentOrders && currentOrders.length > 0) {
  console.log(`Sample order_nos:`, currentOrders.slice(0, 3).map(o => o.order_no).join(", "));
  console.log(`Latest updated:`, currentOrders[0]?.updated_at);
}

// Step 2: Get Shopee account info
console.log("\n[STEP 2] Shopee Account Info:");
console.log("-".repeat(80));

const { data: accounts } = await supabase
  .from("platform_accounts")
  .select("id, shop_id, platform, last_synced_at, status")
  .eq("platform", "shopee")
  .eq("status", "connected");

if (!accounts || accounts.length === 0) {
  console.log("ERROR: No connected Shopee account found");
  Deno.exit(1);
}

const account = accounts[0];
console.log(`Shop ID: ${account.shop_id}`);
console.log(`Account ID: ${account.id}`);
console.log(`Last synced: ${account.last_synced_at}`);

// Step 3: Call shopee-sync-orders function
console.log("\n[STEP 3] Invoking shopee-sync-orders function:");
console.log("-".repeat(80));

const startTime = Date.now();
let syncResponse;
let syncError;

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

  const text = await response.text();
  const elapsed = Date.now() - startTime;

  console.log(`HTTP Status: ${response.status}`);
  console.log(`Response time: ${elapsed}ms`);
  console.log(`Response headers:`);
  console.log(`  Content-Type: ${response.headers.get("content-type")}`);
  console.log(`  Content-Length: ${response.headers.get("content-length")}`);

  try {
    syncResponse = JSON.parse(text);
  } catch (e) {
    console.log(`\nERROR: Response was not valid JSON`);
    console.log(`Raw response (first 500 chars):`);
    console.log(text.slice(0, 500));
    Deno.exit(1);
  }

  console.log(`\nResponse body:`);
  console.log(JSON.stringify(syncResponse, null, 2));

  if (!response.ok) {
    console.log(`\n⚠️  Function returned error status ${response.status}`);
  }
} catch (e) {
  console.log(`ERROR calling function: ${e.message}`);
  syncError = e;
}

// Step 4: Wait a bit for DB writes to complete
console.log("\n[STEP 4] Waiting for sync to complete...");
await new Promise(resolve => setTimeout(resolve, 2000));

// Step 5: Check sync_logs for details
console.log("\n[STEP 5] Sync Logs (last 10):");
console.log("-".repeat(80));

const { data: logs } = await supabase
  .from("sync_logs")
  .select("*")
  .ilike("action", "%shopee%")
  .order("created_at", { ascending: false })
  .limit(10);

if (logs && logs.length > 0) {
  logs.forEach((log, i) => {
    console.log(`\n[${i + 1}] ${log.created_at}`);
    console.log(`    Action: ${log.action}`);
    console.log(`    Status: ${log.status}`);
    console.log(`    Message: ${log.message}`);
  });
} else {
  console.log("No Shopee sync logs found");
}

// Step 6: Check sync_progress
console.log("\n[STEP 6] Sync Progress:");
console.log("-".repeat(80));

const { data: progress } = await supabase
  .from("platform_sync_progress")
  .select("*")
  .eq("account_id", account.id);

if (progress && progress.length > 0) {
  const p = progress[0];
  console.log(`Status: ${p.status}`);
  console.log(`Orders synced: ${p.orders_synced}`);
  console.log(`Pages fetched: ${p.pages_fetched}`);
  console.log(`Sync window: ${new Date(p.sync_window_from * 1000).toISOString()} to ${new Date(p.sync_window_to * 1000).toISOString()}`);
  console.log(`Updated at: ${p.updated_at}`);
  if (p.last_error) {
    console.log(`Last error: ${p.last_error}`);
  }
}

// Step 7: Get new Shopee READY_TO_SHIP count
console.log("\n[STEP 7] ERP Status AFTER sync:");
console.log("-".repeat(80));

const { data: afterOrders } = await supabase
  .from("orders")
  .select("id, order_no, platform, platform_status", { count: "exact" })
  .eq("platform", "shopee")
  .eq("platform_status", "READY_TO_SHIP");

const erpReadyToShipAfter = afterOrders?.length || 0;
console.log(`ERP Shopee READY_TO_SHIP orders AFTER sync: ${erpReadyToShipAfter}`);
console.log(`Change: ${erpReadyToShipAfter - erpReadyToShipBefore} orders`);

// Step 8: Summary
console.log("\n" + "=".repeat(80));
console.log("VERIFICATION SUMMARY");
console.log("=".repeat(80));

let shopeeApiReturnedCount = null;
let erpBeforeCount = erpReadyToShipBefore;
let erpAfterCount = erpReadyToShipAfter;

if (syncResponse && syncResponse.results && Array.isArray(syncResponse.results)) {
  const result = syncResponse.results[0];
  if (result && typeof result === "object") {
    // Estimate based on sync_progress or response
    if (result.syncedOrders !== undefined) {
      console.log(`Shopee API returned: ~${result.syncedOrders} order(s) in this run`);
    }
  }
}

console.log(`\nKEY NUMBERS:`);
console.log(`1. ERP BEFORE sync: ${erpBeforeCount} READY_TO_SHIP orders`);
console.log(`2. ERP AFTER sync:  ${erpAfterCount} READY_TO_SHIP orders`);
console.log(`3. Change:          ${erpAfterCount - erpBeforeCount} orders`);

if (erpAfterCount > erpBeforeCount) {
  console.log(`\n✅ SUCCESS: Sync added ${erpAfterCount - erpBeforeCount} new READY_TO_SHIP orders`);
} else if (erpAfterCount === erpBeforeCount && erpBeforeCount > 0) {
  console.log(`\n⚠️  UNCHANGED: No new READY_TO_SHIP orders were added`);
} else {
  console.log(`\n❌ ISSUE: Sync did not add expected orders`);
}

console.log("\n" + "=".repeat(80));
