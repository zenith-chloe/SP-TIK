import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getTikTokOrders() {
  console.log('\n🔍 === ALL TIKTOK ORDERS IN DATABASE ===\n');
  
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_no, platform, created_at, updated_at, platform_status')
    .eq('platform', 'tiktok')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log('No TikTok orders found');
    return;
  }

  console.log(`Found ${data.length} TikTok order(s):\n`);
  
  data.forEach((order, idx) => {
    console.log(`${idx + 1}. Order No: ${order.order_no}`);
    console.log(`   ID: ${order.id}`);
    console.log(`   Status: ${order.platform_status}`);
    console.log(`   Created: ${order.created_at}`);
    console.log();
  });

  // Check if any has settlement
  console.log('\n🔍 === CHECKING SETTLEMENTS ===\n');
  
  for (const order of data) {
    const { data: settlement } = await supabase
      .from('order_settlements')
      .select('*')
      .eq('order_no', order.order_no)
      .eq('platform', 'tiktok')
      .limit(1);
    
    if (settlement && settlement.length > 0) {
      const s = settlement[0];
      console.log(`✓ Order ${order.order_no} HAS settlement:`);
      console.log(`  total_fees: ${s.total_fees}`);
      console.log(`  tiktok_settlement_amount: ${s.tiktok_settlement_amount}`);
      console.log(`  tiktok_gmv_max_ad_fee: ${s.tiktok_gmv_max_ad_fee}`);
      console.log(`  Synced: ${s.synced_at}`);
      console.log();
    } else {
      console.log(`✗ Order ${order.order_no} NO settlement yet`);
    }
  }
}

await getTikTokOrders();
