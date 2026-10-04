import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function investigateSchema() {
  console.log('\n📊 === INVESTIGATING DATABASE SCHEMA ===\n');
  
  // Step 1: Get one order to see actual schema
  console.log('STEP 1: Reading sample order record...\n');
  const { data: sampleOrder } = await supabase
    .from('orders')
    .select('*')
    .limit(1);

  if (sampleOrder && sampleOrder.length > 0) {
    console.log('✓ Found sample order. All columns:');
    Object.keys(sampleOrder[0]).forEach(col => {
      console.log(`   - ${col}`);
    });
    console.log();
  }

  // Step 2: Check platform values
  console.log('\nSTEP 2: Checking PLATFORM field values...\n');
  const { data: platforms } = await supabase
    .from('orders')
    .select('platform')
    .neq('platform', null);

  if (platforms && platforms.length > 0) {
    const unique = [...new Set(platforms.map(p => p.platform))];
    console.log(`Found ${unique.length} unique platform value(s):`);
    unique.forEach(p => {
      const count = platforms.filter(x => x.platform === p).length;
      console.log(`   "${p}": ${count} order(s)`);
    });
  }
  console.log();

  // Step 3: Check source/channel fields
  console.log('\nSTEP 3: Checking SOURCE/CHANNEL/other fields...\n');
  if (sampleOrder && sampleOrder.length > 0) {
    const sample = sampleOrder[0];
    const possiblePlatformFields = ['source', 'channel', 'shop', 'seller', 'platform_source', 'order_source'];
    
    possiblePlatformFields.forEach(field => {
      if (sample.hasOwnProperty(field)) {
        console.log(`✓ "${field}" exists: ${sample[field]}`);
      }
    });
  }
  console.log();

  // Step 4: Get all distinct platform values with count
  console.log('\nSTEP 4: Getting all DISTINCT platform values and counts...\n');
  const { data: allOrders } = await supabase
    .from('orders')
    .select('platform, count', { count: 'exact' });

  if (allOrders) {
    const grouped = {};
    allOrders.forEach(o => {
      const p = o.platform || 'NULL';
      grouped[p] = (grouped[p] || 0) + 1;
    });
    
    console.log('Platform distribution:');
    Object.entries(grouped).forEach(([p, count]) => {
      console.log(`   "${p}": ${count}`);
    });
  }
  console.log();

  // Step 5: Check order_settlements structure
  console.log('\nSTEP 5: Checking order_settlements table...\n');
  const { data: sampleSettlement } = await supabase
    .from('order_settlements')
    .select('*')
    .limit(1);

  if (sampleSettlement && sampleSettlement.length > 0) {
    console.log('✓ Found sample settlement. Columns:');
    Object.keys(sampleSettlement[0]).forEach(col => {
      console.log(`   - ${col}`);
    });
  } else {
    console.log('✗ No settlements found');
  }
  console.log();

  // Step 6: Check platform values in order_settlements
  console.log('\nSTEP 6: Checking PLATFORM field in order_settlements...\n');
  const { data: settlementPlatforms } = await supabase
    .from('order_settlements')
    .select('platform, count', { count: 'exact' });

  if (settlementPlatforms && settlementPlatforms.length > 0) {
    const grouped = {};
    settlementPlatforms.forEach(s => {
      const p = s.platform || 'NULL';
      grouped[p] = (grouped[p] || 0) + 1;
    });
    
    console.log('Settlement platform distribution:');
    Object.entries(grouped).forEach(([p, count]) => {
      console.log(`   "${p}": ${count}`);
    });
  } else {
    console.log('✗ No settlements found');
  }
  console.log();

  // Step 7: If we found a platform value for TikTok, query it
  console.log('\nSTEP 7: Looking for "TikTok" orders with any variant...\n');
  const { data: tiktokLike } = await supabase
    .from('orders')
    .select('platform')
    .ilike('platform', '%tiktok%');

  if (tiktokLike && tiktokLike.length > 0) {
    const unique = [...new Set(tiktokLike.map(o => o.platform))];
    console.log(`✓ Found ${tiktokLike.length} TikTok-like orders:`);
    unique.forEach(p => {
      console.log(`   Exact value: "${p}"`);
    });
  } else {
    console.log('✗ No TikTok-like orders found');
  }
}

await investigateSchema();
