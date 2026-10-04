import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkDbState() {
  console.log('\n📊 === DATABASE STATE AUDIT ===\n');
  
  const tables = [
    'orders',
    'order_items',
    'order_settlements',
    'tiktok_returns',
    'shopee_returns',
    'products',
    'product_listings',
    'platform_accounts',
    'tiktok_affiliate_commissions',
  ];
  
  console.log('Checking table row counts:\n');
  
  for (const table of tables) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.log(`❌ ${table}: ERROR - ${error.message}`);
    } else {
      const hasData = count > 0 ? '✓' : '✗';
      console.log(`${hasData} ${table}: ${count} rows`);
    }
  }
  
  // Check platform_accounts
  console.log('\n\nChecking platform_accounts (OAuth connections):\n');
  
  const { data: accounts, error: accErr } = await supabase
    .from('platform_accounts')
    .select('id, platform, account_name, status')
    .limit(10);
  
  if (accErr) {
    console.log(`❌ Error: ${accErr.message}`);
  } else if (accounts && accounts.length > 0) {
    console.log(`✓ Found ${accounts.length} platform connections:`);
    accounts.forEach(a => {
      console.log(`  - ${a.platform}: ${a.account_name} (status: ${a.status})`);
    });
  } else {
    console.log('❌ No platform accounts configured');
  }
}

await checkDbState();
