import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mzc3MjE1MSwiZXhwIjoyMDk5MzQ4MTUxfQ.rXx6ePzJvqvjHc_OQ2N1bBP8HJVq8OZ9CdVjLspZMh8";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function auditDbSchema() {
  console.log('\n📊 === DATABASE SCHEMA AUDIT ===\n');

  // Query 1: List all tables in public schema
  console.log('Step 1: Listing all tables in public schema...\n');

  const { data: tables, error: tablesErr } = await supabase
    .rpc('get_all_tables');

  if (tablesErr) {
    console.log('RPC not available, trying direct table check...\n');
  } else if (tables) {
    console.log('Tables found:');
    tables.forEach(t => console.log(`  - ${t.table_name}`));
    console.log();
  }

  // Query 2: Check if order_settlements exists by trying to query it
  console.log('Step 2: Checking if order_settlements table exists...\n');

  const { data: osData, error: osErr } = await supabase
    .from('order_settlements')
    .select('*')
    .limit(1);

  if (osErr) {
    console.log('❌ order_settlements table query failed:');
    console.log(`   Code: ${osErr.code}`);
    console.log(`   Message: ${osErr.message}`);

    if (osErr.message && osErr.message.includes('not found')) {
      console.log('   → Table does NOT exist in database\n');
    }
  } else {
    console.log('✓ order_settlements table EXISTS');
    console.log(`  Records: ${osData?.length || 0}\n`);

    if (osData && osData.length > 0) {
      console.log('Columns found:');
      Object.keys(osData[0]).forEach(col => {
        console.log(`  - ${col}`);
      });
    }
  }

  // Query 3: Check for other settlement-related tables
  console.log('\nStep 3: Searching for settlement-related tables...\n');

  const possibleTables = [
    'order_settlements',
    'settlements',
    'tiktok_settlements',
    'shopee_settlements',
    'order_settlement_details',
    'settlement_transactions',
    'tiktok_settlement_transactions',
  ];

  for (const tableName of possibleTables) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .limit(1);

    if (!error) {
      console.log(`✓ Found table: ${tableName}`);
      console.log(`  Row count: ${data?.length || 0}`);
      if (data && data.length > 0) {
        console.log(`  Columns: ${Object.keys(data[0]).join(', ')}`);
      }
    }
  }

  // Query 4: Check sync_logs for settlement sync entries
  console.log('\n\nStep 4: Checking sync_logs for settlement sync activity...\n');

  const { data: syncLogs, error: syncErr } = await supabase
    .from('sync_logs')
    .select('action, status, message, created_at')
    .in('action', ['tiktok_settlement_sync', 'shopee_settlement_sync'])
    .order('created_at', { ascending: false })
    .limit(20);

  if (syncErr) {
    console.log(`⚠️  Could not query sync_logs: ${syncErr.message}`);
  } else if (syncLogs && syncLogs.length > 0) {
    console.log(`✓ Found ${syncLogs.length} settlement sync log entries:`);
    syncLogs.forEach((log, idx) => {
      console.log(`\n  ${idx + 1}. ${log.action}`);
      console.log(`     Status: ${log.status}`);
      console.log(`     Message: ${log.message}`);
      console.log(`     Time: ${log.created_at}`);
    });
  } else {
    console.log('❌ No settlement sync logs found');
  }

  // Query 5: Check for Shopee settlement sync function
  console.log('\n\nStep 5: Checking Shopee settlement data...\n');

  const { data: shopeeSettlements, error: shopeeErr } = await supabase
    .from('order_settlements')
    .select('order_no, platform, synced_at')
    .eq('platform', 'shopee')
    .limit(5);

  if (shopeeErr) {
    console.log(`⚠️  Could not query Shopee settlements: ${shopeeErr.message}`);
  } else if (shopeeSettlements && shopeeSettlements.length > 0) {
    console.log(`✓ Found ${shopeeSettlements.length} Shopee settlements`);
    console.log('Sample records:');
    shopeeSettlements.forEach(s => {
      console.log(`  Order: ${s.order_no}, Platform: ${s.platform}, Synced: ${s.synced_at}`);
    });
  } else {
    console.log('❌ No Shopee settlements found');
  }

  // Query 6: Check for TikTok settlement with raw_response
  console.log('\n\nStep 6: Checking TikTok settlement data with raw_response...\n');

  const { data: tiktokSettlements, error: tiktokErr } = await supabase
    .from('order_settlements')
    .select('order_no, platform, synced_at, raw_response')
    .eq('platform', 'tiktok')
    .limit(5);

  if (tiktokErr) {
    console.log(`⚠️  Could not query TikTok settlements: ${tiktokErr.message}`);
  } else if (tiktokSettlements && tiktokSettlements.length > 0) {
    console.log(`✓ Found ${tiktokSettlements.length} TikTok settlements with raw_response`);

    tiktokSettlements.forEach((s, idx) => {
      console.log(`\n  ${idx + 1}. Order: ${s.order_no}`);
      console.log(`     Synced: ${s.synced_at}`);

      if (s.raw_response) {
        const raw = s.raw_response;
        console.log(`     raw_response structure:`);
        console.log(`       Top-level keys: ${Object.keys(raw).join(', ')}`);

        if (raw.statement_transactions && Array.isArray(raw.statement_transactions)) {
          console.log(`       statement_transactions: ${raw.statement_transactions.length} item(s)`);

          if (raw.statement_transactions.length > 0) {
            const firstTxn = raw.statement_transactions[0];
            console.log(`       First transaction keys: ${Object.keys(firstTxn).join(', ')}`);

            // Look for GMV Max ad fee
            const allKeys = Object.keys(firstTxn);
            const gmvRelated = allKeys.filter(k =>
              k.toLowerCase().includes('gmv') ||
              k.toLowerCase().includes('max') ||
              (k.toLowerCase().includes('ad') && k.toLowerCase().includes('fee'))
            );

            if (gmvRelated.length > 0) {
              console.log(`       GMV/Max/Ad fee fields: ${gmvRelated.join(', ')}`);
              gmvRelated.forEach(field => {
                console.log(`         ${field}: ${JSON.stringify(firstTxn[field])}`);
              });
            } else {
              console.log(`       (No GMV/Max/Ad fee fields found)`);
            }
          }
        }
      }
    });
  } else {
    console.log('❌ No TikTok settlements found');
  }
}

await auditDbSchema();
