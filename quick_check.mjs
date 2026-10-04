import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function quickCheck() {
  // Check all tables for new data
  const tables = [
    'platform_accounts',
    'orders',
    'order_settlements',
    'tiktok_affiliate_commissions'
  ];
  
  console.log('\n📊 Quick Database State Check\n');
  
  for (const table of tables) {
    const { count } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    
    console.log(`${table}: ${count} rows`);
  }
  
  // Try to get any platform_accounts data
  console.log('\nChecking platform_accounts details:\n');
  const { data: accounts } = await supabase
    .from('platform_accounts')
    .select('*')
    .limit(10);
  
  if (accounts && accounts.length > 0) {
    console.log(`✓ Found ${accounts.length} account(s)`);
    accounts.forEach(a => {
      console.log(`  - ${a.platform}: ${a.account_name} (${a.status})`);
    });
  } else {
    console.log('✗ No accounts found');
  }
}

await quickCheck();
