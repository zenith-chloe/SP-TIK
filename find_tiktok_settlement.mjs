import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function findTikTokSettlement() {
  console.log('\n🔍 === FINDING TIKTOK SETTLEMENTS AFTER 2026-09-15 ===\n');
  
  // Query for TikTok settlements after 2026-09-15
  const { data, error } = await supabase
    .from('order_settlements')
    .select('order_no, platform, synced_at, raw_response, total_fees, tiktok_settlement_amount')
    .eq('platform', 'tiktok')
    .gte('synced_at', '2026-09-15')
    .order('synced_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log('❌ No TikTok settlements after 2026-09-15 found\n');
    
    console.log('Trying any TikTok settlements...\n');
    const { data: allSettl } = await supabase
      .from('order_settlements')
      .select('order_no, platform, synced_at, raw_response')
      .eq('platform', 'tiktok')
      .order('synced_at', { ascending: false })
      .limit(5);
    
    if (allSettl && allSettl.length > 0) {
      console.log(`✓ Found ${allSettl.length} TikTok settlement(s) total:\n`);
      allSettl.forEach(s => {
        console.log(`- ${s.order_no} (synced: ${s.synced_at})`);
        console.log(`  Has raw_response: ${s.raw_response ? '✓' : '✗'}`);
      });
    } else {
      console.log('❌ NO TikTok settlements in database at all\n');
      
      console.log('Checking total settlement count...');
      const { data: allCount } = await supabase
        .from('order_settlements')
        .select('count', { count: 'exact' });
      
      console.log(`Total settlements in DB: ${allCount?.length || 0}`);
    }
    process.exit(1);
  }

  console.log(`✅ Found ${data.length} TikTok settlement(s) after 2026-09-15:\n`);

  for (const settlement of data) {
    console.log(`\n📋 === SETTLEMENT ${settlement.order_no} ===`);
    console.log(`Synced: ${settlement.synced_at}`);
    console.log(`Total Fees (DB): ${settlement.total_fees}`);
    console.log(`Settlement Amount: ${settlement.tiktok_settlement_amount}`);
    
    if (!settlement.raw_response) {
      console.log('❌ NO raw_response');
      continue;
    }

    console.log('✓ Has raw_response\n');
    
    const rawResp = settlement.raw_response;
    
    // Check structure
    if (!rawResp.statement_transactions) {
      console.log('❌ No statement_transactions');
      continue;
    }

    console.log(`✓ Found statement_transactions: ${rawResp.statement_transactions.length} item(s)\n`);
    
    const txn = rawResp.statement_transactions[0];
    
    console.log('=== FIRST TRANSACTION (ALL FIELDS) ===\n');
    console.log(JSON.stringify(txn, null, 2));
    
    console.log('\n\n=== SEARCHING FOR FEE-RELATED FIELDS ===\n');
    
    const allKeys = Object.keys(txn).sort();
    const feeKeys = allKeys.filter(k => {
      const lower = k.toLowerCase();
      return lower.includes('fee') || lower.includes('commission') || 
             lower.includes('gmv') || lower.includes('ad') || lower.includes('affiliate');
    });
    
    console.log('📍 FEE/COMMISSION FIELDS FOUND:');
    feeKeys.forEach(key => {
      const val = txn[key];
      console.log(`  ${key}: ${val}`);
    });
    
    // Try to identify affiliate commission and ads commission
    console.log('\n\n=== FIELD MAPPING ===\n');
    console.log('Affiliate Commission (should be ~0.94):');
    const affiliateFields = allKeys.filter(k => 
      k.toLowerCase().includes('affiliate') && 
      k.toLowerCase().includes('commission') &&
      !k.toLowerCase().includes('ads') &&
      !k.toLowerCase().includes('partner')
    );
    affiliateFields.forEach(k => console.log(`  ${k}: ${txn[k]}`));
    
    console.log('\nAffiliate Ads Commission (if exists):');
    const adsFields = allKeys.filter(k => 
      k.toLowerCase().includes('affiliate') && 
      (k.toLowerCase().includes('ads') || k.toLowerCase().includes('ad'))
    );
    if (adsFields.length > 0) {
      adsFields.forEach(k => console.log(`  ${k}: ${txn[k]}`));
    } else {
      console.log('  (none found)');
    }
    
    console.log('\nGMV Max Fee (should be ~2.03):');
    const gmvFields = allKeys.filter(k => 
      k.toLowerCase().includes('gmv') || 
      (k.toLowerCase().includes('max') && k.toLowerCase().includes('ad'))
    );
    if (gmvFields.length > 0) {
      gmvFields.forEach(k => console.log(`  ${k}: ${txn[k]}`));
    } else {
      console.log('  ❌ NOT FOUND IN THIS RESPONSE');
    }
  }
}

await findTikTokSettlement();
