import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function findOrder() {
  console.log('\n🔍 === SEARCH FOR ORDER 586304457764341074 ===\n');
  
  // Search in orders table
  console.log('1. Searching orders table...');
  const { data: orders1, error: err1 } = await supabase
    .from('orders')
    .select('order_no')
    .eq('order_no', '586304457764341074');
  
  if (!err1 && orders1?.length > 0) {
    console.log('✓ Found in orders table');
  } else {
    console.log('✗ Not in orders table by exact match');
    
    // Try with ilike (case insensitive)
    const { data: orders2 } = await supabase
      .from('orders')
      .select('order_no')
      .ilike('order_no', '%586304457764341074%');
    
    if (orders2?.length > 0) {
      console.log('✓ Found with ILIKE search:', orders2.map(o => o.order_no).join(', '));
    } else {
      console.log('✗ Not found even with fuzzy search');
    }
  }

  // Search in settlements
  console.log('\n2. Searching order_settlements table...');
  const { data: settl1 } = await supabase
    .from('order_settlements')
    .select('order_no')
    .eq('order_no', '586304457764341074');
  
  if (settl1?.length > 0) {
    console.log('✓ Found in order_settlements');
  } else {
    console.log('✗ Not in settlements by exact match');
  }

  // Get all TikTok orders and settlements
  console.log('\n3. Listing ALL TikTok orders and their settlements...\n');
  
  const { data: allOrders } = await supabase
    .from('orders')
    .select('order_no, platform')
    .eq('platform', 'tiktok');
  
  if (allOrders && allOrders.length > 0) {
    console.log(`Found ${allOrders.length} TikTok order(s):\n`);
    
    for (const order of allOrders) {
      console.log(`Order: ${order.order_no}`);
      
      const { data: settl } = await supabase
        .from('order_settlements')
        .select('order_no, raw_response, tiktok_gmv_max_ad_fee, tiktok_affiliate_ads_commission, total_fees')
        .eq('order_no', order.order_no)
        .eq('platform', 'tiktok');
      
      if (settl && settl.length > 0) {
        console.log('  ✓ HAS settlement data');
        const s = settl[0];
        console.log(`    - tiktok_gmv_max_ad_fee: ${s.tiktok_gmv_max_ad_fee}`);
        console.log(`    - tiktok_affiliate_ads_commission: ${s.tiktok_affiliate_ads_commission}`);
        console.log(`    - total_fees: ${s.total_fees}`);
        
        if (s.raw_response && s.raw_response.statement_transactions) {
          console.log(`    ✓ Has statement_transactions in raw_response`);
        }
      } else {
        console.log('  ✗ NO settlement data');
      }
      console.log();
    }
  } else {
    console.log('❌ NO TikTok orders found in database');
  }
  
  // Check if order 586304457764341074 exists anywhere (any platform)
  console.log('\n4. Searching for order 586304457764341074 on ANY platform...\n');
  const { data: anyOrder } = await supabase
    .from('orders')
    .select('order_no, platform')
    .eq('order_no', '586304457764341074');
  
  if (anyOrder && anyOrder.length > 0) {
    console.log('✓ Found on platform:', anyOrder[0].platform);
  } else {
    console.log('✗ Order does not exist in database at all');
    console.log('\n⚠️  The order 586304457764341074 is NOT in the database.');
    console.log('   This might be:');
    console.log('   - A test/example order from TikTok Seller Center (not synced to ERP)');
    console.log('   - Not yet synced to the database');
    console.log('   - Belonging to a different TikTok shop/account');
  }
}

await findOrder();
