import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkAffiliateCommissions() {
  console.log('\n📊 === TIKTOK_AFFILIATE_COMMISSIONS TABLE ===\n');

  console.log('Step 1: Get table structure\n');

  const { data: sample, error: sampleErr } = await supabase
    .from('tiktok_affiliate_commissions')
    .select('*')
    .limit(1);

  if (sampleErr) {
    console.log(`❌ Error: ${sampleErr.message}`);
    return;
  }

  if (sample && sample.length > 0) {
    console.log('Columns in tiktok_affiliate_commissions:');
    Object.keys(sample[0]).forEach(col => {
      console.log(`  - ${col}`);
    });

    console.log('\n\nStep 2: Sample data\n');
    console.log(JSON.stringify(sample[0], null, 2));
  }

  // Check if order_no is in this table
  console.log('\n\nStep 3: Checking if this table has order references\n');

  const { data: sampleOrders, error: ordersErr } = await supabase
    .from('tiktok_affiliate_commissions')
    .select('order_no, creator_id, estimated_paid_commission, estimated_paid_shop_ads_commission')
    .limit(5);

  if (!ordersErr && sampleOrders) {
    console.log(`✓ Sample affiliate commission records:`);
    sampleOrders.forEach((rec, idx) => {
      console.log(`\n  ${idx + 1}. Order: ${rec.order_no}`);
      console.log(`     Creator: ${rec.creator_id}`);
      console.log(`     Commission: ${rec.estimated_paid_commission}`);
      console.log(`     Shop Ads Commission: ${rec.estimated_paid_shop_ads_commission}`);
    });
  }

  // Count unique order_nos
  console.log('\n\nStep 4: Statistics\n');

  const { data: allRecs } = await supabase
    .from('tiktok_affiliate_commissions')
    .select('order_no')
    .limit(4259);

  if (allRecs) {
    const uniqueOrders = new Set(allRecs.map(r => r.order_no));
    console.log(`Total records: ${allRecs.length}`);
    console.log(`Unique order_nos: ${uniqueOrders.size}`);
  }
}

await checkAffiliateCommissions();
