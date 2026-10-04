import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function findSettlementOrder() {
  console.log('\n🔍 === FINDING ORDERS WITH SETTLEMENTS ===\n');

  // Step 1: Check if order_settlements has any data
  console.log('Step 1: Checking order_settlements data...\n');
  const { data: allSettlements, error: allErr } = await supabase
    .from('order_settlements')
    .select('order_no, platform, synced_at, tiktok_transaction_fee, tiktok_commission_fee, tiktok_seller_shipping_fee, tiktok_affiliate_commission, tiktok_affiliate_ads_commission, tiktok_platform_discount, tiktok_settlement_amount, total_fees')
    .limit(100);

  if (allErr) {
    console.error('❌ Error:', allErr.message);
    return;
  }

  console.log(`✓ Found ${allSettlements?.length || 0} settlements\n`);

  if (allSettlements && allSettlements.length > 0) {
    console.log('Recent settlements (TikTok):');
    const tiktokSettlements = allSettlements.filter(s => s.platform === 'tiktok').slice(0, 10);

    tiktokSettlements.forEach(s => {
      console.log(`\n  Order: ${s.order_no}`);
      console.log(`  Platform: ${s.platform}`);
      console.log(`  Synced at: ${s.synced_at}`);
      console.log(`  Transaction fee: ${s.tiktok_transaction_fee}`);
      console.log(`  Commission fee: ${s.tiktok_commission_fee}`);
      console.log(`  Seller shipping fee: ${s.tiktok_seller_shipping_fee}`);
      console.log(`  Affiliate commission: ${s.tiktok_affiliate_commission}`);
      console.log(`  Affiliate ads commission: ${s.tiktok_affiliate_ads_commission}`);
      console.log(`  Platform discount: ${s.tiktok_platform_discount}`);
      console.log(`  Settlement amount: ${s.tiktok_settlement_amount}`);
      console.log(`  Total fees: ${s.total_fees}`);
    });

    // Step 2: Get one settlement with full raw_response
    if (tiktokSettlements.length > 0) {
      console.log('\n\nStep 2: Fetching full raw_response for first settlement...\n');
      const { data: fullSettlement, error: fullErr } = await supabase
        .from('order_settlements')
        .select('*')
        .eq('order_no', tiktokSettlements[0].order_no)
        .single();

      if (fullErr) {
        console.error('❌ Error:', fullErr.message);
        return;
      }

      console.log(`Order: ${fullSettlement.order_no}`);
      console.log('\nColumn names in order_settlements:');
      Object.keys(fullSettlement).forEach(col => {
        if (col !== 'raw_response') {
          console.log(`  - ${col}`);
        } else {
          console.log(`  - ${col} [JSONB object]`);
        }
      });

      // Step 3: Analyze raw_response
      console.log('\n\nStep 3: Analyzing raw_response...\n');

      if (fullSettlement.raw_response) {
        const raw = fullSettlement.raw_response;

        // Check if statement_transactions exists
        if (raw.statement_transactions && Array.isArray(raw.statement_transactions)) {
          console.log(`✓ Found ${raw.statement_transactions.length} statement_transaction(s)`);

          if (raw.statement_transactions.length > 0) {
            const firstTxn = raw.statement_transactions[0];
            console.log('\nFields in first statement_transaction:');
            console.log(JSON.stringify(firstTxn, null, 2));

            // Step 4: Search for all numeric values
            console.log('\n\nStep 4: All numeric values in statement_transaction:');

            function getAllNumbers(obj, path = '') {
              const results = [];

              if (typeof obj === 'number') {
                results.push({ path, value: obj });
              } else if (typeof obj === 'string') {
                const num = parseFloat(obj);
                if (!isNaN(num)) {
                  results.push({ path, value: num, stringValue: obj });
                }
              } else if (typeof obj === 'object' && obj !== null) {
                if (Array.isArray(obj)) {
                  obj.forEach((item, idx) => {
                    results.push(...getAllNumbers(item, `${path}[${idx}]`));
                  });
                } else {
                  Object.entries(obj).forEach(([key, val]) => {
                    results.push(...getAllNumbers(val, path ? `${path}.${key}` : key));
                  });
                }
              }

              return results;
            }

            const allNumbers = getAllNumbers(firstTxn);
            allNumbers.forEach(num => {
              console.log(`  ${num.path}: ${num.value}${num.stringValue ? ` (string: "${num.stringValue}")` : ''}`);
            });
          }
        } else {
          console.log('❌ No statement_transactions found in raw_response');
          console.log('\nRaw response top-level keys:');
          Object.keys(raw).forEach(key => {
            console.log(`  - ${key}`);
          });
        }
      }
    }
  } else {
    console.log('❌ No settlements found');
  }
}

await findSettlementOrder();
