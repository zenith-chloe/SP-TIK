import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkInfoSchema() {
  console.log('\n📊 === CHECKING TABLES VIA INFORMATION_SCHEMA ===\n');

  // Try to get structure of order_settlements using introspection
  console.log('Attempt 1: Direct select with limit 0 to check if table exists\n');

  const { data: d1, error: e1 } = await supabase
    .from('order_settlements')
    .select('*')
    .limit(0);

  if (e1) {
    console.log(`❌ order_settlements query error:`);
    console.log(`   ${e1.message}\n`);
  } else {
    console.log(`✓ order_settlements exists and is accessible\n`);
  }

  // Try different settlement table names
  console.log('Attempt 2: Testing different table names\n');

  const tableNames = [
    'order_settlements',
    'tiktok_settlements',
    'shopee_settlements',
    'settlements',
    'settlement_transactions',
  ];

  for (const table of tableNames) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .limit(1);

    if (!error) {
      console.log(`✓ ${table} — EXISTS (${data?.length || 0} records)`);
      if (data && data.length > 0) {
        const cols = Object.keys(data[0]);
        console.log(`  Columns: ${cols.join(', ')}\n`);
      } else {
        console.log(`  (empty table, columns unknown)\n`);
      }
    }
  }

  // Check sync_logs directly
  console.log('\nAttempt 3: Checking sync_logs for settlement activity\n');

  const { data: logs, error: logsErr } = await supabase
    .from('sync_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (logsErr) {
    console.log(`❌ sync_logs error: ${logsErr.message}\n`);
  } else if (logs) {
    console.log(`✓ sync_logs accessible (${logs.length} records)\n`);

    const settlementLogs = logs.filter(l =>
      l.action?.includes('settlement') ||
      l.message?.includes('settlement')
    );

    if (settlementLogs.length > 0) {
      console.log(`Settlement-related logs (${settlementLogs.length}):`);
      settlementLogs.slice(0, 10).forEach(log => {
        console.log(`  ${log.created_at} — ${log.action} — ${log.status}`);
        console.log(`    ${log.message.substring(0, 100)}`);
      });
    } else {
      console.log('No settlement-related logs found');
    }
  }

  // Try querying Shopee returns which might use settlements
  console.log('\n\nAttempt 4: Checking for return/settlement related tables\n');

  const relatedTables = [
    'tiktok_returns',
    'shopee_returns',
    'order_refunds',
    'refund_settlements',
  ];

  for (const table of relatedTables) {
    const { error } = await supabase
      .from(table)
      .select('*')
      .limit(1);

    if (!error) {
      const { data } = await supabase
        .from(table)
        .select('*')
        .limit(1);

      console.log(`✓ ${table} — EXISTS`);
      if (data && data.length > 0) {
        console.log(`  Columns: ${Object.keys(data[0]).join(', ')}`);
      }
    }
  }

  // Check orders table for settlement-related fields
  console.log('\n\nAttempt 5: Checking orders table for settlement fields\n');

  const { data: orderSample, error: orderErr } = await supabase
    .from('orders')
    .select('*')
    .limit(1);

  if (orderErr) {
    console.log(`❌ orders query error: ${orderErr.message}`);
  } else if (orderSample && orderSample.length > 0) {
    const orderCols = Object.keys(orderSample[0]);
    console.log(`✓ orders table columns (${orderCols.length}):`);
    orderCols.forEach(col => console.log(`  - ${col}`));

    const settlementRelated = orderCols.filter(c =>
      c.toLowerCase().includes('settlement') ||
      c.toLowerCase().includes('fee') ||
      c.toLowerCase().includes('commission')
    );

    if (settlementRelated.length > 0) {
      console.log(`\n Settlement-related columns in orders:`);
      settlementRelated.forEach(col => console.log(`  - ${col}`));
    }
  }
}

await checkInfoSchema();
