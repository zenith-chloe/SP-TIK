// Run this in browser console
const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.38.4/+esm';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function diagnose() {
  console.log("========== SHOPEE ORDER DIAGNOSTIC ==========\n");
  
  // 1. Get all Shopee orders
  console.log("1. Fetching all Shopee orders...");
  const { data: shopeeOrders, error: e1 } = await supabase
    .from("orders")
    .select("*")
    .eq("platform", "Shopee");
  
  if (e1) {
    console.log("ERROR:", e1);
  } else {
    console.log(`Total Shopee orders: ${shopeeOrders.length}`);
    
    // Count by order_status
    const byOrderStatus = {};
    shopeeOrders.forEach(o => {
      byOrderStatus[o.order_status] = (byOrderStatus[o.order_status] || 0) + 1;
    });
    console.log("By order_status:", byOrderStatus);
    
    // Count by platform_status
    const byPlatformStatus = {};
    shopeeOrders.forEach(o => {
      const ps = o.platform_status || "NULL";
      byPlatformStatus[ps] = (byPlatformStatus[ps] || 0) + 1;
    });
    console.log("By platform_status:", byPlatformStatus);
    
    // Count isPendingOrder (status=待处理, platformStatus!=UNPAID, printCount=0)
    const pendingOrders = shopeeOrders.filter(o => 
      o.order_status === "待处理" && 
      o.platform_status !== "UNPAID" && 
      !(o.print_count > 0)
    );
    console.log(`\nPending orders (即时订单/待处理): ${pendingOrders.length}`);
    if (pendingOrders.length > 0) {
      console.log("Sample:", pendingOrders.slice(0, 2));
    }
    
    // Count instant delivery orders
    const instantOrders = shopeeOrders.filter(o => 
      o.courier && o.courier.toLowerCase().includes("instant")
    );
    console.log(`Instant delivery orders: ${instantOrders.length}`);
    if (instantOrders.length > 0) {
      console.log("Sample:", instantOrders.slice(0, 2));
    }
  }
  
  // 2. Check platform_sync_progress
  console.log("\n\n2. Checking platform_sync_progress...");
  const { data: progress, error: e2 } = await supabase
    .from("platform_sync_progress")
    .select("*");
  
  if (e2) {
    console.log("ERROR:", e2);
  } else {
    console.log("Sync progress:", JSON.stringify(progress, null, 2));
  }
  
  // 3. Check recent sync logs
  console.log("\n\n3. Checking recent sync logs...");
  const { data: logs, error: e3 } = await supabase
    .from("sync_logs")
    .select("*")
    .ilike("message", "%shopee%")
    .order("created_at", { ascending: false })
    .limit(10);
  
  if (e3) {
    console.log("ERROR:", e3);
  } else {
    console.log("Recent Shopee sync logs:");
    logs.forEach(log => console.log(`[${log.created_at}] ${log.status}: ${log.message}`));
  }
}

diagnose().catch(console.error);
