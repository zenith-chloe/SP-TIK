import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function queryOrder() {
  console.log('\n🔍 === QUERYING ORDER SETTLEMENT ===\n');
  
  const { data, error } = await supabase
    .from('order_settlements')
    .select('*')
    .eq('order_no', '586304457764341074')
    .eq('platform', 'tiktok');

  if (error) {
    console.error('❌ Query Error:', error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log('❌ No settlement data found for order: 586304457764341074');
    console.log('\nChecking if order exists...');
    const { data: orderData } = await supabase
      .from('orders')
      .select('order_no, platform, created_at')
      .eq('order_no', '586304457764341074')
      .limit(1);
    
    if (orderData && orderData.length > 0) {
      console.log('✓ Order EXISTS in orders table');
      console.log('  But NO settlement row in order_settlements');
      console.log('  → Settlement data has not been synced yet!');
    } else {
      console.log('✗ Order NOT found in database');
    }
    process.exit(1);
  }

  console.log(`✅ Found ${data.length} settlement record(s)\n`);
  
  const settlement = data[0];
  
  console.log('📋 === SETTLEMENT INFO ===');
  console.log('Order No:', settlement.order_no);
  console.log('Platform:', settlement.platform);
  console.log('Synced At:', settlement.synced_at);
  
  console.log('\n💰 === FEES IN DATABASE ===');
  console.log('tiktok_commission_fee:', settlement.tiktok_commission_fee);
  console.log('tiktok_transaction_fee:', settlement.tiktok_transaction_fee);
  console.log('tiktok_seller_shipping_fee:', settlement.tiktok_seller_shipping_fee);
  console.log('tiktok_affiliate_commission:', settlement.tiktok_affiliate_commission);
  console.log('tiktok_affiliate_ads_commission:', settlement.tiktok_affiliate_ads_commission);
  console.log('tiktok_gmv_max_ad_fee:', settlement.tiktok_gmv_max_ad_fee || '(column does not exist)');
  console.log('---');
  console.log('total_fees (DB sum):', settlement.total_fees);
  console.log('tiktok_settlement_amount:', settlement.tiktok_settlement_amount);
  
  if (!settlement.raw_response) {
    console.log('\n❌ raw_response is NULL');
    process.exit(1);
  }

  const rawResp = settlement.raw_response;
  console.log('\n📄 === RAW API RESPONSE ===');
  console.log('Top-level keys:', Object.keys(rawResp).join(', '));
  
  if (rawResp.statement_transactions && Array.isArray(rawResp.statement_transactions)) {
    console.log('\n✅ statement_transactions found:', rawResp.statement_transactions.length, 'item(s)\n');
    
    const txn = rawResp.statement_transactions[0];
    if (txn) {
      console.log('=== FIRST TRANSACTION (FULL) ===\n');
      console.log(JSON.stringify(txn, null, 2));
      
      console.log('\n\n=== FEE-RELATED FIELDS ===\n');
      
      const allKeys = Object.keys(txn).sort();
      const feeKeys = allKeys.filter(k => 
        k.toLowerCase().includes('fee') || 
        k.toLowerCase().includes('commission') || 
        k.toLowerCase().includes('gmv') || 
        k.toLowerCase().includes('ad') ||
        k.toLowerCase().includes('affiliate')
      );
      
      if (feeKeys.length > 0) {
        feeKeys.forEach(key => {
          const value = txn[key];
          console.log(`✓ ${key}: ${value}`);
        });
      } else {
        console.log('No fee-related keys found. All keys:');
        allKeys.forEach(key => {
          console.log(`  - ${key}: ${txn[key]}`);
        });
      }
    }
  } else {
    console.log('\n❌ No statement_transactions in raw_response');
    console.log('\nFull raw_response:');
    console.log(JSON.stringify(rawResp, null, 2));
  }
}

await queryOrder();
