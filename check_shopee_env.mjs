import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
);

console.log("=== 检查生产环境 ===\n");

const { data: acc } = await sb.from("platform_accounts").select("id,platform,status,access_token");
if (acc && acc.length > 0) {
  console.log("✅ Platform accounts found:");
  acc.forEach(a => {
    console.log(`  ${a.platform}: status=${a.status}, has_token=${!!a.access_token}`);
  });
} else {
  console.log("❌ 没有任何 platform_accounts（Shopee / TikTok 账户）");
}

const { data: orders, count: totalOrders } = await sb
  .from("orders")
  .select("id, platform, platform_status", { count: "exact" });

if (totalOrders === 0) {
  console.log("❌ 数据库完全为空 - 没有任何订单");
} else {
  console.log(`\n📊 订单统计（共 ${totalOrders}）：`);

  const byPlatform = {};
  orders.forEach(o => {
    if (!byPlatform[o.platform]) byPlatform[o.platform] = {};
    const key = o.platform_status || "null";
    byPlatform[o.platform][key] = (byPlatform[o.platform][key] || 0) + 1;
  });

  Object.entries(byPlatform).forEach(([platform, statuses]) => {
    console.log(`  ${platform}:`);
    Object.entries(statuses).forEach(([status, count]) => {
      console.log(`    ${status}: ${count}`);
    });
  });
}

console.log("\n=== 检查结论 ===");
if (acc && acc.some(a => a.platform === "shopee" && a.status === "connected")) {
  console.log("✅ 可以运行真实 Shopee 同步");
} else {
  console.log("❌ 无法运行真实 Shopee 同步 - 没有已连接的 Shopee 账户");
  console.log("原因：");
  console.log("  1. Shopee OAuth 尚未配置或已过期");
  console.log("  2. 或者这是一个测试/开发环境数据库");
  console.log("\n需要：在生产 Shopee 账户已连接的环境中运行测试");
}
