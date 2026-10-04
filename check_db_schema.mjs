import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mzc3MjE1MSwiZXhwIjoyMDk5MzQ4MTUxfQ.rXx6ePzJvqvjHc_OQ2N1bBP8HJVq8OZ9CdVjLspZMh8";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkDbSchema() {
  console.log('\n📊 === CHECKING DATABASE SCHEMA ===\n');

  // Try to query information_schema to check if table exists
  const { data, error } = await supabase
    .rpc('check_table_exists', { table_name: 'order_settlements' });

  if (error) {
    console.error('RPC error (may not exist):', error.message);
  }

  // Alternative: Try to list all tables
  console.log('Checking if order_settlements table exists...\n');

  const { data: allData, error: allError } = await supabase
    .from('order_settlements')
    .select('*')
    .limit(1);

  if (allError) {
    console.log('❌ Error accessing order_settlements:');
    console.log(`   Code: ${allError.code}`);
    console.log(`   Message: ${allError.message}`);
    console.log(`   Details: ${allError.details}`);

    if (allError.code === 'PGRST110' || allError.message.includes('not found')) {
      console.log('\n   → Table does not exist or is not accessible');
      return;
    }
  } else {
    console.log('✓ order_settlements table exists!');
    if (allData && allData.length > 0) {
      console.log(`  Has data: YES (${allData.length} rows visible)`);
      console.log('\n  Columns:');
      Object.keys(allData[0]).forEach(col => {
        const val = allData[0][col];
        console.log(`    - ${col}: ${typeof val}${val === null ? ' (null)' : ''}`);
      });
    } else {
      console.log('  Has data: NO (empty table)');

      // Try specific columns to infer schema
      console.log('\n  Attempting to infer schema by trying specific columns...');

      const testColumns = [
        'id', 'order_id', 'order_no', 'platform',
        'tiktok_transaction_fee', 'tiktok_commission_fee', 'tiktok_seller_shipping_fee',
        'tiktok_affiliate_commission', 'tiktok_affiliate_ads_commission', 'tiktok_platform_discount',
        'tiktok_gmv_max_ad_fee', 'tiktok_settlement_amount', 'total_fees', 'net_settlement',
        'raw_response', 'synced_at', 'created_at'
      ];

      for (const col of testColumns) {
        try {
          const { error: e } = await supabase
            .from('order_settlements')
            .select(col)
            .limit(0);

          if (!e) {
            console.log(`    ✓ ${col}`);
          }
        } catch (err) {
          // Silent
        }
      }
    }
  }
}

await checkDbSchema();
