import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkSyncLogs() {
  console.log('\n📋 === CHECKING TIKTOK SETTLEMENT SYNC LOGS ===\n');

  // Check if table exists
  const { count: totalCount } = await supabase
    .from('sync_logs')
    .select('*', { count: 'exact', head: true });

  console.log(`Total sync_logs records: ${totalCount}\n`);

  // Get recent logs without timeout issue
  console.log('Fetching recent logs (limit 30)...\n');

  const { data: recentLogs, error: recentErr } = await supabase
    .from('sync_logs')
    .select('created_at, action, status, message')
    .order('created_at', { ascending: false })
    .limit(30);

  if (recentErr) {
    console.log(`❌ Error: ${recentErr.message}`);
    return;
  }

  if (!recentLogs || recentLogs.length === 0) {
    console.log('No sync logs found');
    return;
  }

  console.log(`✓ Found ${recentLogs.length} recent logs\n`);
  console.log('Recent logs:');

  recentLogs.forEach((log, idx) => {
    if (idx < 20) {
      console.log(`\n${idx + 1}. [${log.created_at}]`);
      console.log(`   Action: ${log.action}`);
      console.log(`   Status: ${log.status}`);
      console.log(`   Message: ${log.message}`);
    }
  });

  // Count settlement-related logs
  console.log('\n\nCounting settlement sync activities...\n');

  const settlementLogs = recentLogs.filter(l =>
    l.action?.includes('settlement') ||
    l.message?.includes('settlement')
  );

  const tiktokSettlementLogs = settlementLogs.filter(l => l.action?.includes('tiktok'));
  const shopeeSettlementLogs = settlementLogs.filter(l => l.action?.includes('shopee'));

  console.log(`TikTok settlement sync attempts: ${tiktokSettlementLogs.length}`);
  if (tiktokSettlementLogs.length > 0) {
    console.log('  Recent TikTok settlement logs:');
    tiktokSettlementLogs.slice(0, 5).forEach(log => {
      console.log(`    ${log.created_at} — ${log.status} — ${log.message.substring(0, 80)}`);
    });
  }

  console.log(`\nShopee settlement sync attempts: ${shopeeSettlementLogs.length}`);
  if (shopeeSettlementLogs.length > 0) {
    console.log('  Recent Shopee settlement logs:');
    shopeeSettlementLogs.slice(0, 5).forEach(log => {
      console.log(`    ${log.created_at} — ${log.status} — ${log.message.substring(0, 80)}`);
    });
  }

  // Check for specific error patterns
  console.log('\n\nChecking for settlement sync errors...\n');

  const errorLogs = recentLogs.filter(l =>
    l.status === 'failed' &&
    (l.action?.includes('settlement') || l.message?.includes('settlement'))
  );

  if (errorLogs.length > 0) {
    console.log(`✗ Found ${errorLogs.length} failed settlement sync attempts:`);
    errorLogs.slice(0, 5).forEach(log => {
      console.log(`  ${log.created_at}`);
      console.log(`    Action: ${log.action}`);
      console.log(`    Message: ${log.message}`);
    });
  } else {
    console.log('No failed settlement sync logs found');
  }
}

await checkSyncLogs();
