import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://dtttdgdkhayzchmfptjt.supabase.co";
// Try with service role key for full access
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!serviceRoleKey) {
  console.log("No SUPABASE_SERVICE_ROLE_KEY found");
  console.log("Checking what's available...");
}

// Try with anon key first
const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(supabaseUrl, anonKey);

try {
  // Check if sync_logs exists
  console.log("=== Checking sync_logs table ===");
  const { data: syncLogs, error: syncError } = await supabase
    .from("sync_logs")
    .select("count()");
  
  if (syncError) {
    console.log("sync_logs error:", syncError);
  } else {
    console.log("sync_logs exists, query result:", syncLogs);
  }
} catch (e) {
  console.log("Error:", e.message);
}

try {
  // Check platform_accounts
  console.log("\n=== Checking platform_accounts table ===");
  const { data: accounts, error: accountsError } = await supabase
    .from("platform_accounts")
    .select("*");
  
  if (accountsError) {
    console.log("platform_accounts error:", accountsError);
  } else {
    console.log("platform_accounts count:", accounts?.length);
    console.log("First few accounts:", JSON.stringify(accounts?.slice(0, 3), null, 2));
  }
} catch (e) {
  console.log("Error:", e.message);
}

try {
  // Check orders
  console.log("\n=== Checking orders table ===");
  const { data: orders, error: ordersError, count } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true });
  
  if (ordersError) {
    console.log("orders error:", ordersError);
  } else {
    console.log("orders count:", count);
  }
} catch (e) {
  console.log("Error:", e.message);
}
