import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://dtttdgdkhayzchmfptjt.supabase.co";
const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(supabaseUrl, anonKey);

console.log("=== TikTok Order Count Check ===\n");

// Get all TikTok orders with platform_status
const { data: allOrders, error: allError } = await supabase
  .from("orders")
  .select("platform_status, order_status")
  .eq("platform", "tiktok");

if (allError) {
  console.log("Error fetching orders:", allError);
  process.exit(1);
}

console.log(`Total TikTok orders in ERP: ${allOrders?.length || 0}\n`);

// Count by platform_status
const platformCounts = {};
allOrders?.forEach(o => {
  const status = o.platform_status || 'NULL';
  platformCounts[status] = (platformCounts[status] || 0) + 1;
});

console.log("📊 By TikTok Platform Status:");
console.log("─".repeat(50));
for (const [status, count] of Object.entries(platformCounts).sort((a, b) => b[1] - a[1])) {
  const emoji = status === 'AWAITING_SHIPMENT' ? '📦' : 
                status === 'AWAITING_COLLECTION' ? '📍' :
                status === 'IN_TRANSIT' ? '🚚' :
                status === 'DELIVERED' ? '✓' :
                status === 'COMPLETED' ? '✅' :
                status === 'CANCELLED' ? '❌' : '❓';
  console.log(`${emoji} ${status.padEnd(25)} : ${count}`);
}

// Count by ERP order_status
const erpCounts = {};
allOrders?.forEach(o => {
  const status = o.order_status || 'NULL';
  erpCounts[status] = (erpCounts[status] || 0) + 1;
});

console.log("\n📊 By ERP Status:");
console.log("─".repeat(50));
for (const [status, count] of Object.entries(erpCounts).sort((a, b) => b[1] - a[1])) {
  const label = status === 'pending' ? '待发货 (Awaiting Shipment)' :
                status === 'processing' ? '待取货 (Awaiting Collection)' :
                status === 'shipped' ? '运输中 (In Transit)' :
                status === 'returned' ? '已退货' :
                status === 'cancelled' ? '已取消' : status;
  console.log(`${label.padEnd(30)} : ${count}`);
}

// Total to ship (pending + processing)
const toShip = (erpCounts['pending'] || 0) + (erpCounts['processing'] || 0);
console.log("\n" + "=".repeat(50));
console.log(`✨ Total "To Ship" (待发货 + 待取货): ${toShip}`);
console.log("   Expected from TikTok: 48 (awaiting_shipment) + 1 (awaiting_collection) = 49");
console.log("   Status: " + (toShip === 49 ? "✅ MATCH" : `⚠️  MISMATCH (expected 49, got ${toShip})`));

// Check sync progress
console.log("\n=== Sync Progress Status ===\n");
const { data: progress, error: progressError } = await supabase
  .from("platform_sync_progress")
  .select("*");

if (!progressError && progress?.length > 0) {
  const p = progress[0];
  console.log(`Status: ${p.status}`);
  console.log(`Sync Type: ${p.sync_type}`);
  console.log(`Pages Fetched: ${p.pages_fetched}`);
  console.log(`Orders Synced: ${p.orders_synced}`);
  console.log(`Last Error: ${p.last_error || 'None'}`);
  console.log(`Updated: ${p.updated_at}`);
} else {
  console.log("No sync progress found");
}

// Check last platform account status
console.log("\n=== TikTok Account Status ===\n");
const { data: accounts, error: accountsError } = await supabase
  .from("platform_accounts")
  .select("account_name, status, last_synced_at")
  .eq("platform", "tiktok");

if (!accountsError && accounts?.length > 0) {
  const acc = accounts[0];
  console.log(`Account: ${acc.account_name}`);
  console.log(`Status: ${acc.status}`);
  console.log(`Last Synced: ${acc.last_synced_at || 'Never'}`);
} else {
  console.log("No TikTok account found");
}

console.log("\n" + "=".repeat(50));
