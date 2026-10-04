import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function verifyAndCallAPI() {
  console.log('\n🔐 === TIKTOK OAUTH & API VERIFICATION ===\n');

  // Step 1: Check platform_accounts for TikTok connection
  console.log('Step 1: Verifying TikTok OAuth connection\n');

  const { data: tiktokAccounts, error: accountErr } = await supabase
    .from('platform_accounts')
    .select('id, platform, account_name, status, access_token, refresh_token, shop_cipher, token_expires_at')
    .eq('platform', 'tiktok');

  if (accountErr) {
    console.log(`❌ Error fetching platform_accounts: ${accountErr.message}`);
    return;
  }

  if (!tiktokAccounts || tiktokAccounts.length === 0) {
    console.log('❌ No TikTok accounts found');
    return;
  }

  console.log(`✓ Found ${tiktokAccounts.length} TikTok account(s)\n`);

  const account = tiktokAccounts[0];
  console.log(`Account: ${account.account_name}`);
  console.log(`Status: ${account.status}`);
  console.log(`Access Token: ${account.access_token ? '✓ Present' : '✗ Missing'}`);
  console.log(`Refresh Token: ${account.refresh_token ? '✓ Present' : '✗ Missing'}`);
  console.log(`Shop Cipher: ${account.shop_cipher ? '✓ Present' : '✗ Missing'}`);
  console.log(`Token Expires: ${account.token_expires_at || '(unknown)'}\n`);

  if (account.status !== 'connected') {
    console.log(`❌ Account status is '${account.status}', not 'connected'`);
    return;
  }

  if (!account.access_token || !account.shop_cipher) {
    console.log('❌ Missing required tokens/params');
    return;
  }

  console.log('✓ OAuth connection verified\n');

  // Step 2: Find orders to test with
  console.log('\nStep 2: Finding orders for API testing\n');

  const { data: orders, error: orderErr } = await supabase
    .from('orders')
    .select('id, order_no, platform_status, total_amount')
    .eq('platform', 'tiktok')
    .in('platform_status', ['COMPLETED', 'DELIVERED'])
    .order('updated_at', { ascending: false })
    .limit(5);

  if (orderErr) {
    console.log(`❌ Error fetching orders: ${orderErr.message}`);
    return;
  }

  if (!orders || orders.length === 0) {
    console.log('❌ No completed/delivered TikTok orders found for testing');
    console.log('   (Cannot proceed without a real order)');
    return;
  }

  const testOrder = orders[0];
  console.log(`✓ Found test order: ${testOrder.order_no}`);
  console.log(`  Status: ${testOrder.platform_status}`);
  console.log(`  Amount: ${testOrder.total_amount}\n`);

  // Step 3: Call TikTok settlement API
  console.log(`\nStep 3: Calling TikTok Settlement API\n`);

  try {
    // Get TIKTOK_APP_KEY and APP_SECRET from environment (these should be set in Supabase)
    // For now, we'll need to get them via Edge Function call

    console.log(`Making request to: GET /finance/202309/orders/${testOrder.order_no}/statement_transactions\n`);

    // We need to make a request through the edge function or get the credentials
    // Let's try calling the existing tiktok-settlement-sync with debug

    const response = await fetch(
      'https://dtttdgdkhayzchmfptjt.supabase.co/functions/v1/tiktok-settlement-sync',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'x-sync-secret': '4f032ead5eaafcd8fdb9538d947b9acf6a952cfed11b9caaa73995f8aa4accfa'
        },
        body: JSON.stringify({
          orderIds: [testOrder.order_no],
          debug: true // Request debug output
        })
      }
    );

    const result = await response.json();

    console.log('Step 4: API Response\n');
    console.log(JSON.stringify(result, null, 2));

    // Step 5: Check order_settlements for the synced data
    console.log('\n\nStep 5: Checking synced settlement data\n');

    const { data: settlement, error: settlErr } = await supabase
      .from('order_settlements')
      .select('*')
      .eq('order_no', testOrder.order_no)
      .single();

    if (settlErr) {
      console.log(`⚠️  Settlement not yet synced: ${settlErr.message}`);
    } else if (settlement) {
      console.log('✓ Settlement data found\n');
      console.log('Columns in settlement:');
      Object.keys(settlement).forEach(col => {
        if (col === 'raw_response' && settlement[col]) {
          console.log(`  - ${col}: [JSONB object]`);

          // Analyze raw_response
          const raw = settlement[col];
          if (raw.statement_transactions && Array.isArray(raw.statement_transactions)) {
            console.log(`\n    statement_transactions structure:`);
            const txn = raw.statement_transactions[0];
            if (txn) {
              console.log(`    Fields in first transaction:`);
              Object.keys(txn).forEach(field => {
                const val = txn[field];
                const display = typeof val === 'object' ? '[OBJECT]' : val;
                console.log(`      - ${field}: ${display}`);
              });

              // Look for RM1.10 / 1.10
              console.log(`\n    Searching for 1.10 value:`);
              let found = false;
              Object.entries(txn).forEach(([field, val]) => {
                if (typeof val === 'number' && Math.abs(val - 1.10) < 0.01) {
                  console.log(`      ✓ FOUND: ${field} = ${val}`);
                  found = true;
                }
              });
              if (!found) {
                console.log(`      ✗ No field with value ~1.10 found`);
              }
            }
          }
        } else if (typeof settlement[col] === 'object') {
          console.log(`  - ${col}: [OBJECT]`);
        } else {
          console.log(`  - ${col}: ${settlement[col]}`);
        }
      });
    }

  } catch (e) {
    console.error(`❌ Error calling API: ${e.message}`);
  }
}

await verifyAndCallAPI();
