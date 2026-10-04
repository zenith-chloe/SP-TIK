import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkData() {
  console.log('\n🔍 === CHECKING TIKTOK ORDERS ===\n');
  
  // Check orders table
  const { data: orders, error: orderErr } = await supabase
    .from('orders')
    .select('count', { count: 'exact' })
    .eq('platform', 'tiktok');
  
  if (!orderErr) {
    console.log('✓ TikTok orders in table:', orders?.length || 0);
  }

  // Check settlements with gmv_max
  console.log('\n🔍 === CHECKING SETTLEMENT TABLE STRUCTURE ===\n');
  
  const { data: settlements, error: settlementErr } = await supabase
    .from('order_settlements')
    .select('*')
    .eq('platform', 'tiktok')
    .limit(1);

  if (settlementErr) {
    console.error('Error querying settlements:', settlementErr.message);
  } else if (settlements && settlements.length > 0) {
    const sample = settlements[0];
    console.log('✓ Sample settlement columns:');
    Object.keys(sample).forEach(key => {
      const val = sample[key];
      if (typeof val === 'object' && val !== null) {
        console.log(`  ${key}: [object ${val.constructor.name}] (truncated)`);
      } else {
        console.log(`  ${key}: ${val}`);
      }
    });
  } else {
    console.log('ℹ No TikTok settlements in database yet');
    
    // Try to get any settlement to see structure
    console.log('\n📋 === CHECKING ANY SETTLEMENT ===\n');
    const { data: anySett } = await supabase
      .from('order_settlements')
      .select('*')
      .limit(1);
    
    if (anySett && anySett.length > 0) {
      console.log('✓ Columns in order_settlements:');
      Object.keys(anySett[0]).forEach(key => {
        console.log(`  - ${key}`);
      });
    }
  }
  
  // Check if column exists
  console.log('\n🔍 === CHECKING IF tiktok_gmv_max_ad_fee COLUMN EXISTS ===\n');
  const { data: schemaCheck } = await supabase
    .from('order_settlements')
    .select('tiktok_gmv_max_ad_fee')
    .limit(1);
  
  if (schemaCheck !== undefined) {
    console.log('✓ Column tiktok_gmv_max_ad_fee EXISTS in table');
  } else {
    console.log('✗ Column tiktok_gmv_max_ad_fee DOES NOT EXIST');
  }
}

await checkData();
