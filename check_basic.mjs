import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkBasic() {
  console.log('\n🔍 === BASIC TABLE CHECKS ===\n');
  
  // Try to get row count for orders
  console.log('1. Checking orders table count...');
  const { count: ordersCount, error: err1 } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true });

  if (err1) {
    console.log(`   Error: ${err1.message}`);
  } else {
    console.log(`   Total rows: ${ordersCount}`);
  }

  // Try settlements
  console.log('\n2. Checking order_settlements table count...');
  const { count: settCount, error: err2 } = await supabase
    .from('order_settlements')
    .select('*', { count: 'exact', head: true });

  if (err2) {
    console.log(`   Error: ${err2.message}`);
  } else {
    console.log(`   Total rows: ${settCount}`);
  }

  // Try to get actual data with minimal select
  console.log('\n3. Trying minimal query on orders...');
  const { data: d1, error: err3 } = await supabase
    .from('orders')
    .select('id')
    .limit(1);

  if (err3) {
    console.log(`   Error: ${err3.message}`);
  } else if (d1 && d1.length > 0) {
    console.log(`   ✓ Can read orders table`);
    console.log(`   First record has id: ${d1[0].id}`);
  } else {
    console.log(`   No data returned (possible RLS blocking)`);
  }

  // Check settlements
  console.log('\n4. Trying minimal query on order_settlements...');
  const { data: d2, error: err4 } = await supabase
    .from('order_settlements')
    .select('id')
    .limit(1);

  if (err4) {
    console.log(`   Error: ${err4.message}`);
  } else if (d2 && d2.length > 0) {
    console.log(`   ✓ Can read settlements table`);
  } else {
    console.log(`   No data returned (possible RLS blocking)`);
  }

  // Diagnosis
  console.log('\n📋 === DIAGNOSIS ===\n');
  
  if (ordersCount === 0 && settCount === 0) {
    console.log('❌ BOTH tables appear empty');
    console.log('\nPossible reasons:');
    console.log('1. Row Level Security (RLS) blocks all anon reads');
    console.log('2. Tables are actually empty');
    console.log('3. Connection issue\n');
    
    console.log('⚠️  To access data, need:');
    console.log('  - Service Role Key (not anon key)');
    console.log('  - Or appropriate RLS policies for anon access\n');
  }
}

await checkBasic();
