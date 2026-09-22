import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
);

console.log("========== 1. SHOPEE 同步进度 ==========");
const { data: progress } = await supabase
  .from("platform_sync_progress")
  .select("*")
  .eq("account_id", (await supabase.from("platform_accounts").select("id").eq("platform", "Shopee").limit(1)).data?.[0]?.id);
console.log(JSON.stringify(progress, null, 2));

console.log("\n========== 2. 最近的同步日志 ==========");
const { data: syncLogs } = await supabase
  .from("sync_logs")
  .select("*")
  .ilike("message", "%shopee%")
  .order("created_at", { ascending: false })
  .limit(10);
console.log(JSON.stringify(syncLogs, null, 2));

console.log("\n========== 3. ERP 中的 Shopee 订单统计 ==========");
const { data: allShopeeOrders } = await supabase
  .from("orders")
  .select("id, order_no, order_status, platform_status, is_cod, courier, print_count")
  .eq("platform", "Shopee");
console.log(`总数: ${allShopeeOrders?.length}`);

// 计算待处理（即时订单）
const instantOrders = allShopeeOrders?.filter(o => 
  o.order_status === "待处理" && 
  o.platform_status !== "UNPAID" && 
  !(o.print_count > 0)
);
console.log(`待处理订单(即时): ${instantOrders?.length}`);
console.log("详情:", JSON.stringify(instantOrders?.slice(0, 3), null, 2));

// 计算待发货
const toShipOrders = allShopeeOrders?.filter(o => 
  o.order_status === "待处理"
);
console.log(`\n待发货订单(所有待处理): ${toShipOrders?.length}`);

// 按 platform_status 分组
const statusGroups = {};
allShopeeOrders?.forEach(o => {
  const key = o.platform_status || "null";
  statusGroups[key] = (statusGroups[key] || 0) + 1;
});
console.log("\n按 platform_status 分组:", statusGroups);

// 按 order_status 分组
const orderStatusGroups = {};
allShopeeOrders?.forEach(o => {
  orderStatusGroups[o.order_status] = (orderStatusGroups[o.order_status] || 0) + 1;
});
console.log("按 order_status 分组:", orderStatusGroups);

console.log("\n========== 4. Shopee Platform Account 信息 ==========");
const { data: shopeeAccounts } = await supabase
  .from("platform_accounts")
  .select("id, shop_id, platform, last_synced_at")
  .eq("platform", "Shopee");
console.log(JSON.stringify(shopeeAccounts, null, 2));
