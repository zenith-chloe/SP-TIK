import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkSchema() {
  console.log('\n📊 === CHECKING TABLE SCHEMA ===\n');
  
  // Try to select all from order_settlements with very permissive selection
  const { data, error } = await supabase
    .from('order_settlements')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error:', error.message);
  }

  if (data && data.length > 0) {
    console.log('✓ order_settlements table accessible');
    console.log('✓ Columns in table:');
    Object.keys(data[0]).forEach(col => {
      console.log(`   - ${col}`);
    });
  } else {
    console.log('ℹ order_settlements table is empty or not accessible');
    console.log('\nTrying to detect schema by attempting to select specific columns...\n');
    
    const testColumns = [
      'id', 'order_no', 'platform', 'tiktok_commission_fee', 
      'tiktok_transaction_fee', 'tiktok_settlement_amount',
      'tiktok_gmv_max_ad_fee', 'gmv_max_ad_fee', 'total_fees'
    ];
    
    for (const col of testColumns) {
      const { error: e } = await supabase
        .from('order_settlements')
        .select(col)
        .limit(1);
      
      if (!e || e.message.includes('not found') === false) {
        console.log(`   ✓ ${col} (column exists)`);
      } else {
        console.log(`   ✗ ${col}`);
      }
    }
  }
}

await checkSchema();
