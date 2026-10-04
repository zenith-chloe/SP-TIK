import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkTikTokOAuth() {
  console.log('\n🔐 === TIKTOK OAUTH TOKEN CHECK ===\n');

  // Check platform_accounts table for TikTok connections
  console.log('Step 1: Checking platform_accounts table\n');

  const { count: totalCount } = await supabase
    .from('platform_accounts')
    .select('*', { count: 'exact', head: true });

  console.log(`Total platform accounts: ${totalCount}\n`);

  // Get TikTok accounts specifically
  console.log('Step 2: Searching for TikTok accounts\n');

  const { data: tiktokAccounts, error: tiktokErr } = await supabase
    .from('platform_accounts')
    .select('id, platform, account_name, status, access_token, refresh_token, token_expires_at, auth_time')
    .eq('platform', 'tiktok');

  if (tiktokErr) {
    console.log(`❌ Error: ${tiktokErr.message}`);
  } else if (tiktokAccounts && tiktokAccounts.length > 0) {
    console.log(`✓ Found ${tiktokAccounts.length} TikTok account(s):\n`);

    tiktokAccounts.forEach((account, idx) => {
      console.log(`${idx + 1}. ${account.account_name}`);
      console.log(`   ID: ${account.id}`);
      console.log(`   Status: ${account.status}`);
      console.log(`   Access Token: ${account.access_token ? '✓ YES (present)' : '✗ NO'}`);
      console.log(`   Refresh Token: ${account.refresh_token ? '✓ YES (present)' : '✗ NO'}`);
      console.log(`   Token Expires: ${account.token_expires_at || '(not set)'}`);
      console.log(`   Auth Time: ${account.auth_time || '(not set)'}\n`);
    });

    // Check if any token is valid
    const validTokens = tiktokAccounts.filter(a => a.access_token && a.status === 'connected');
    if (validTokens.length > 0) {
      console.log(`✓ FOUND ${validTokens.length} valid TikTok OAuth token(s)`);
    } else {
      console.log(`❌ NO valid TikTok OAuth tokens found`);
      console.log('   (all accounts either lack tokens or not in connected status)');
    }
  } else {
    console.log('❌ NO TikTok accounts found in platform_accounts table');
  }

  // Check Shopee accounts for comparison
  console.log('\n\nStep 3: Checking Shopee accounts (for comparison)\n');

  const { data: shopeeAccounts, error: shopeeErr } = await supabase
    .from('platform_accounts')
    .select('id, platform, account_name, status, access_token, refresh_token')
    .eq('platform', 'shopee');

  if (shopeeErr) {
    console.log(`⚠️  Error: ${shopeeErr.message}`);
  } else if (shopeeAccounts && shopeeAccounts.length > 0) {
    console.log(`✓ Found ${shopeeAccounts.length} Shopee account(s):`);
    shopeeAccounts.forEach((acc) => {
      console.log(`  - ${acc.account_name} (status: ${acc.status}, token: ${acc.access_token ? 'YES' : 'NO'})`);
    });
  } else {
    console.log('❌ No Shopee accounts found');
  }

  // Summary
  console.log('\n\n=== SUMMARY ===\n');

  const totalAccounts = tiktokAccounts?.length || 0;
  const connectedAccounts = tiktokAccounts?.filter(a => a.status === 'connected').length || 0;
  const hasTokens = tiktokAccounts?.filter(a => a.access_token).length || 0;

  console.log(`Total TikTok accounts: ${totalAccounts}`);
  console.log(`Connected accounts: ${connectedAccounts}`);
  console.log(`Accounts with tokens: ${hasTokens}`);

  if (hasTokens === 0) {
    console.log('\n❌ CONCLUSION: No TikTok OAuth tokens available');
    console.log('   Cannot make API requests to TikTok');
    console.log('   User must reconnect TikTok account via OAuth flow');
  } else {
    console.log(`\n✓ CONCLUSION: ${hasTokens} TikTok OAuth token(s) available`);
  }
}

await checkTikTokOAuth();
