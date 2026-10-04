import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkAllOrders() {
  console.log('\n📊 === CHECKING ORDERS TABLE (ALL ROWS) ===\n');

  // Count all orders
  const { count: totalCount, error: countErr } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true });

  console.log(`Total orders in database: ${totalCount}\n`);

  if (totalCount === 0 || totalCount === null) {
    console.log('❌ Orders table is EMPTY');
    return;
  }

  // Get sample data
  console.log(`Fetching sample of ${Math.min(10, totalCount)} orders...\n`);

  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('order_no, platform, platform_status, total_amount, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (ordersErr) {
    console.log(`❌ Error: ${ordersErr.message}`);
    return;
  }

  if (orders && orders.length > 0) {
    console.log('Sample orders:');
    const platforms = new Set();
    orders.forEach((o, idx) => {
      console.log(`\n${idx + 1}. ${o.order_no}`);
      console.log(`   Platform: ${o.platform}`);
      console.log(`   Status: ${o.platform_status}`);
      console.log(`   Amount: ${o.total_amount}`);
      console.log(`   Created: ${o.created_at}`);
      platforms.add(o.platform);
    });

    console.log(`\nPlatforms in database: ${Array.from(platforms).join(', ')}`);
  }

  // Group by platform
  console.log('\n\nStep 2: Grouping orders by platform\n');

  // Get TikTok count
  const { count: tiktokCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'tiktok');

  // Get Shopee count
  const { count: shopeeCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'shopee');

  // Get Telegram count
  const { count: telegramCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'telegram');

  console.log(`TikTok orders: ${tiktokCount}`);
  console.log(`Shopee orders: ${shopeeCount}`);
  console.log(`Telegram orders: ${telegramCount}`);
  console.log(`Total: ${tiktokCount + shopeeCount + telegramCount}`);
}

await checkAllOrders();
