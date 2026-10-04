import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkSettlementSchema() {
  console.log('\n📊 === ORDER_SETTLEMENTS TABLE SCHEMA ===\n');

  // Method 1: Try to select all columns
  console.log('Method 1: Getting schema by selecting all columns\n');

  const columns = [
    'id', 'order_id', 'order_no', 'platform',
    'tiktok_transaction_fee', 'tiktok_commission_fee', 'tiktok_seller_shipping_fee',
    'tiktok_affiliate_commission', 'tiktok_affiliate_ads_commission',
    'tiktok_platform_discount', 'tiktok_settlement_amount',
    'tiktok_gmv_max_ad_fee', // Try this field name
    'total_fees', 'net_settlement', 'raw_response',
    'synced_at', 'created_at', 'updated_at'
  ];

  const existingColumns = [];

  for (const col of columns) {
    const { data, error } = await supabase
      .from('order_settlements')
      .select(col)
      .limit(0);

    if (!error) {
      existingColumns.push(col);
      console.log(`✓ ${col}`);
    } else {
      console.log(`✗ ${col}`);
    }
  }

  console.log(`\n✓ Confirmed columns (${existingColumns.length}): ${existingColumns.join(', ')}\n`);

  // Method 2: Try to fetch one row to see structure (if any exists)
  console.log('Method 2: Trying to fetch sample row for structure\n');

  const { data: sample, error: sampleErr } = await supabase
    .from('order_settlements')
    .select('*')
    .limit(1);

  if (sampleErr) {
    console.log(`❌ Error: ${sampleErr.message}`);
  } else if (sample && sample.length > 0) {
    console.log(`✓ Found ${sample.length} record(s):`);
    console.log('Columns in record:');
    Object.keys(sample[0]).forEach(col => {
      console.log(`  - ${col}`);
    });
  } else {
    console.log('⚠️  Table is empty, cannot get structure from data\n');

    // Method 3: Try individual column names
    console.log('Method 3: Inferring schema by testing column names\n');

    const allTestColumns = [
      // Basic
      'id', 'order_id', 'order_no', 'platform', 'synced_at', 'created_at', 'updated_at',
      // TikTok fees
      'tiktok_transaction_fee', 'tiktok_commission_fee', 'tiktok_seller_shipping_fee',
      'tiktok_affiliate_commission', 'tiktok_affiliate_ads_commission',
      'tiktok_platform_discount', 'tiktok_settlement_amount',
      // GMV Max variations
      'tiktok_gmv_max_ad_fee', 'gmv_max_ad_fee', 'gmv_max_fee',
      'shop_ads_gmv_fee', 'shop_ads_fee', 'gmv_fee',
      'shopee_commission_fee', 'shopee_transaction_fee',
      'total_fees', 'net_settlement', 'raw_response',
    ];

    console.log('Testing column existence:\n');

    for (const col of allTestColumns) {
      const { data, error } = await supabase
        .from('order_settlements')
        .select(col)
        .limit(0);

      if (!error) {
        console.log(`✓ ${col}`);
      }
    }
  }

  // Check if order_settlements has any records at all
  console.log('\n\nMethod 4: Checking total record count\n');

  const { count, error: countErr } = await supabase
    .from('order_settlements')
    .select('*', { count: 'exact', head: true });

  if (countErr) {
    console.log(`❌ Count error: ${countErr.message}`);
  } else {
    console.log(`Total order_settlements records: ${count}`);
  }

  // Check Shopee settlements specifically
  console.log('\n\nMethod 5: Checking Shopee vs TikTok records\n');

  const { count: shopeeCount, error: shopeeErr } = await supabase
    .from('order_settlements')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'shopee');

  const { count: tiktokCount, error: tiktokErr } = await supabase
    .from('order_settlements')
    .select('*', { count: 'exact', head: true })
    .eq('platform', 'tiktok');

  console.log(`Shopee settlements: ${shopeeErr ? '?' : shopeeCount}`);
  console.log(`TikTok settlements: ${tiktokErr ? '?' : tiktokCount}`);

  // Final: Try to get full schema for one specific Shopee/TikTok record
  console.log('\n\nMethod 6: Fetching first record of each platform\n');

  const { data: firstShopee, error: shopeeRecErr } = await supabase
    .from('order_settlements')
    .select('*')
    .eq('platform', 'shopee')
    .limit(1);

  if (!shopeeRecErr && firstShopee && firstShopee.length > 0) {
    console.log('✓ First Shopee settlement found!');
    console.log('Columns:');
    Object.keys(firstShopee[0]).forEach(col => {
      const val = firstShopee[0][col];
      console.log(`  - ${col}: ${typeof val === 'object' ? '[OBJECT]' : val}`);
    });
  } else {
    console.log(`❌ No Shopee settlement: ${shopeeRecErr?.message || 'not found'}`);
  }

  const { data: firstTiktok, error: tiktokRecErr } = await supabase
    .from('order_settlements')
    .select('*')
    .eq('platform', 'tiktok')
    .limit(1);

  if (!tiktokRecErr && firstTiktok && firstTiktok.length > 0) {
    console.log('\n✓ First TikTok settlement found!');
    console.log('Columns:');
    Object.keys(firstTiktok[0]).forEach(col => {
      const val = firstTiktok[0][col];
      if (col === 'raw_response' && typeof val === 'object') {
        console.log(`  - ${col}: [JSONB - checking for GMV fields]`);

        if (val.statement_transactions && Array.isArray(val.statement_transactions)) {
          console.log(`    └─ statement_transactions[0] fields:`);
          const txn = val.statement_transactions[0];
          if (txn) {
            Object.keys(txn).forEach(k => {
              const v = txn[k];
              if (typeof v === 'number' || typeof v === 'string') {
                console.log(`       • ${k}: ${v}`);
              }
            });
          }
        }
      } else if (typeof val === 'object') {
        console.log(`  - ${col}: [OBJECT]`);
      } else {
        console.log(`  - ${col}: ${val}`);
      }
    });
  } else {
    console.log(`\n❌ No TikTok settlement: ${tiktokRecErr?.message || 'not found'}`);
  }
}

await checkSettlementSchema();
