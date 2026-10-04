import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function findCompletedTikTok() {
  console.log('\n🔍 === SEARCHING FOR COMPLETED TIKTOK ORDERS ===\n');
  
  // Search for COMPLETED or DELIVERED TikTok orders
  const statuses = ['COMPLETED', 'DELIVERED'];
  
  for (const status of statuses) {
    console.log(`Searching platform_status = '${status}'...\n`);
    
    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, order_no, platform, platform_status, created_at')
      .eq('platform', 'tiktok')
      .eq('platform_status', status)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.log(`  Error: ${error.message}\n`);
      continue;
    }

    if (!orders || orders.length === 0) {
      console.log(`  No ${status} orders found\n`);
      continue;
    }

    console.log(`✓ Found ${orders.length} ${status} order(s):\n`);

    for (const order of orders) {
      console.log(`Order: ${order.order_no}`);
      console.log(`Status: ${order.platform_status}`);
      console.log(`Created: ${order.created_at}`);

      // Check for settlement
      const { data: settlements } = await supabase
        .from('order_settlements')
        .select('*')
        .eq('order_no', order.order_no)
        .eq('platform', 'tiktok')
        .limit(1);

      if (!settlements || settlements.length === 0) {
        console.log('  Settlement: ✗ NOT FOUND\n');
        continue;
      }

      const settlement = settlements[0];
      console.log('  Settlement: ✓ FOUND');
      console.log(`  Synced: ${settlement.synced_at}`);
      console.log(`  Has raw_response: ${settlement.raw_response ? '✓' : '✗'}`);
      
      if (!settlement.raw_response) {
        console.log('  (No data to analyze)\n');
        continue;
      }

      // Analyze raw_response
      const rawResp = settlement.raw_response;
      
      if (!rawResp.statement_transactions || rawResp.statement_transactions.length === 0) {
        console.log('  No statement_transactions\n');
        continue;
      }

      const txn = rawResp.statement_transactions[0];
      const allKeys = Object.keys(txn);
      
      // Look for GMV Max
      const gmvKeys = allKeys.filter(k => 
        k.toLowerCase().includes('gmv') || 
        (k.toLowerCase().includes('max') && k.toLowerCase().includes('ad'))
      );
      
      const hasGmv = gmvKeys.length > 0;
      
      console.log(`  GMV Max fields: ${hasGmv ? '✓ FOUND' : '✗ NOT FOUND'}`);
      
      if (hasGmv) {
        console.log('\n  🎯 THIS IS THE ORDER WE NEED!\n');
        console.log(`  Order No: ${order.order_no}`);
        console.log(`  Status: ${order.platform_status}`);
        console.log(`  Created: ${order.created_at}`);
        console.log(`  Synced Settlement: ${settlement.synced_at}`);
        
        console.log('\n  === FULL TRANSACTION DATA ===\n');
        console.log(JSON.stringify(txn, null, 2));
        
        process.exit(0);
      }
      
      console.log();
    }
  }
  
  console.log('❌ NO COMPLETED/DELIVERED TIKTOK ORDERS WITH SETTLEMENT FOUND\n');
  
  // Fallback: list all TikTok orders regardless of status
  console.log('Listing ALL TikTok orders...\n');
  const { data: allOrders } = await supabase
    .from('orders')
    .select('order_no, platform_status, created_at')
    .eq('platform', 'tiktok')
    .order('created_at', { ascending: false })
    .limit(20);

  if (allOrders && allOrders.length > 0) {
    console.log(`Found ${allOrders.length} TikTok order(s):`);
    allOrders.forEach(o => {
      console.log(`  - ${o.order_no} (${o.platform_status}, ${o.created_at})`);
    });
  } else {
    console.log('NO TIKTOK ORDERS IN DATABASE');
  }
}

await findCompletedTikTok();
