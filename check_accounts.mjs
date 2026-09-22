import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
);

console.log("Checking platform accounts...\n");

const { data: allAccounts } = await supabase
  .from("platform_accounts")
  .select("*");

console.log("All platform accounts:");
if (allAccounts && allAccounts.length > 0) {
  allAccounts.forEach(acc => {
    console.log(`  - Platform: ${acc.platform}, Shop ID: ${acc.shop_id}, Status: ${acc.status}`);
    console.log(`    ID: ${acc.id}`);
    console.log(`    Has access_token: ${!!acc.access_token}`);
    console.log(`    Last synced: ${acc.last_synced_at}`);
  });
} else {
  console.log("  (none)");
}

console.log("\n\nChecking orders by platform...\n");

const platforms = ["shopee", "tiktok", "telegram"];
for (const platform of platforms) {
  const { data: orders, error, count } = await supabase
    .from("orders")
    .select("platform_status", { count: "exact" })
    .eq("platform", platform);

  if (orders) {
    console.log(`${platform.toUpperCase()}: ${orders.length} total orders`);

    // Group by status
    const byStatus = {};
    orders.forEach(o => {
      byStatus[o.platform_status] = (byStatus[o.platform_status] || 0) + 1;
    });

    Object.entries(byStatus).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
  }
}

console.log("\n\nSample recent Shopee orders:");
const { data: shopeeOrders } = await supabase
  .from("orders")
  .select("id, order_no, platform_status, created_at")
  .eq("platform", "shopee")
  .order("created_at", { ascending: false })
  .limit(5);

if (shopeeOrders && shopeeOrders.length > 0) {
  shopeeOrders.forEach(o => {
    console.log(`  ${o.order_no}: ${o.platform_status} (${o.created_at})`);
  });
}
