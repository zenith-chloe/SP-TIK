import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkOrdersAndSettlements() {
  console.log('\n📊 === CHECKING ORDERS AND SETTLEMENTS ===\n');

  // Count TikTok orders
  console.log('Step 1: Counting TikTok orders\n');

  const { count: tiktokCount, error: tiktokErr } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'tiktok');

  const { count: shopeeCount, error: shopeeErr } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'shopee');

  console.log(`TikTok orders: ${tiktokErr ? '?' : tiktokCount}`);
  console.log(`Shopee orders: ${shopeeErr ? '?' : shopeeCount}\n`);

  // Get a sample TikTok order
  console.log('Step 2: Getting sample TikTok order\n');

  const { data: tiktokOrders, error: orderErr } = await supabase
    .from('orders')
    .select('id, order_no, order_status, platform_status, total_amount')
    .eq('platform', 'tiktok')
    .order('created_at', { ascending: false })
    .limit(3);

  if (orderErr) {
    console.log(`❌ Error: ${orderErr.message}`);
  } else if (tiktokOrders && tiktokOrders.length > 0) {
    console.log(`✓ Found ${tiktokOrders.length} recent TikTok orders:`);
    tiktokOrders.forEach((o, idx) => {
      console.log(`\n  ${idx + 1}. Order: ${o.order_no}`);
      console.log(`     Status: ${o.order_status} / ${o.platform_status}`);
      console.log(`     Amount: ${o.total_amount}`);
    });
  }

  // Check which TikTok orders have settlements
  console.log('\n\nStep 3: Checking which orders have settlements\n');

  const { data: allSettlements, error: settlErr } = await supabase
    .from('order_settlements')
    .select('order_no, order_id, platform')
    .limit(100);

  const settlementOrderNos = new Set(allSettlements?.map(s => s.order_no) || []);

  console.log(`Total settlements: ${allSettlements?.length || 0}`);
  console.log(`Platforms with settlements: ${new Set(allSettlements?.map(s => s.platform) || []).size}`);

  if (tiktokOrders) {
    console.log('\nSample TikTok orders settlement status:');
    tiktokOrders.forEach(o => {
      const hasSettlement = settlementOrderNos.has(o.order_no);
      console.log(`  ${o.order_no}: ${hasSettlement ? '✓ HAS SETTLEMENT' : '✗ NO SETTLEMENT'}`);
    });
  }

  // Get orders that SHOULD have settlement (COMPLETED/DELIVERED status)
  console.log('\n\nStep 4: Finding TikTok orders that should have settlements\n');

  const { data: completedOrders, error: completedErr } = await supabase
    .from('orders')
    .select('order_no, order_status, platform_status, total_amount')
    .eq('platform', 'tiktok')
    .in('platform_status', ['COMPLETED', 'DELIVERED'])
    .order('updated_at', { ascending: false })
    .limit(5);

  if (completedErr) {
    console.log(`❌ Error: ${completedErr.message}`);
  } else if (completedOrders && completedOrders.length > 0) {
    console.log(`✓ Found ${completedOrders.length} TikTok orders in COMPLETED/DELIVERED status:`);

    completedOrders.forEach((o, idx) => {
      const hasSettlement = settlementOrderNos.has(o.order_no);
      console.log(`\n  ${idx + 1}. ${o.order_no}`);
      console.log(`     Platform Status: ${o.platform_status}`);
      console.log(`     Settlement: ${hasSettlement ? '✓ YES' : '✗ NO'}`);
    });
  } else {
    console.log('No completed/delivered TikTok orders found');
  }

  // Check if there's any TikTok order at all
  console.log('\n\nStep 5: Checking any TikTok order (for debugging)\n');

  const { data: anyOrder, error: anyErr } = await supabase
    .from('orders')
    .select('order_no, platform, platform_status')
    .eq('platform', 'tiktok')
    .limit(1);

  if (anyErr) {
    console.log(`❌ Error: ${anyErr.message}`);
  } else if (anyOrder && anyOrder.length > 0) {
    console.log(`✓ Sample TikTok order:`);
    console.log(`  Order No: ${anyOrder[0].order_no}`);
    console.log(`  Platform: ${anyOrder[0].platform}`);
    console.log(`  Status: ${anyOrder[0].platform_status}`);
  }

  // Try to get order 586332886571976197 specifically
  console.log('\n\nStep 6: Searching for order 586332886571976197 specifically\n');

  const { data: targetOrder, error: targetErr } = await supabase
    .from('orders')
    .select('id, order_no, platform, platform_status, order_status')
    .eq('order_no', '586332886571976197');

  if (targetErr) {
    console.log(`❌ Error: ${targetErr.message}`);
  } else if (targetOrder && targetOrder.length > 0) {
    console.log(`✓ Found order 586332886571976197!`);
    console.log(`  ID: ${targetOrder[0].id}`);
    console.log(`  Platform: ${targetOrder[0].platform}`);
    console.log(`  Status: ${targetOrder[0].platform_status}`);
  } else {
    console.log(`❌ Order 586332886571976197 not found`);
  }
}

await checkOrdersAndSettlements();
