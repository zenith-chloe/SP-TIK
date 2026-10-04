import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function investigateGmvFee() {
  console.log('\n🔍 === INVESTIGATING GMV MAX AD FEE ===\n');

  // First, check what columns exist in order_settlements
  console.log('Step 1: Checking order_settlements table structure...\n');
  const { data: sample, error: sampleErr } = await supabase
    .from('order_settlements')
    .select('*')
    .limit(1);

  if (sampleErr) {
    console.error('❌ Error accessing order_settlements:', sampleErr.message);
    return;
  }

  if (sample && sample.length > 0) {
    console.log('✓ order_settlements columns:');
    Object.keys(sample[0]).forEach(col => {
      console.log(`   - ${col}: ${typeof sample[0][col]}`);
    });
  } else {
    console.log('⚠️  order_settlements appears empty');
  }

  // Step 2: Query for the specific order
  console.log('\n\nStep 2: Fetching order 586332886571976197...\n');
  const { data: orders, error: orderErr } = await supabase
    .from('orders')
    .select('id, order_no, platform_status')
    .eq('order_no', '586332886571976197');

  if (orderErr) {
    console.error('❌ Error fetching order:', orderErr.message);
    return;
  }

  if (!orders || orders.length === 0) {
    console.log('❌ Order 586332886571976197 not found');
    return;
  }

  const order = orders[0];
  console.log(`✓ Found order: ${order.order_no}`);
  console.log(`  Status: ${order.platform_status}`);
  console.log(`  ID: ${order.id}`);

  // Step 3: Query the settlement for this order
  console.log('\n\nStep 3: Fetching settlement for this order...\n');
  const { data: settlements, error: settlErr } = await supabase
    .from('order_settlements')
    .select('*')
    .eq('order_no', '586332886571976197');

  if (settlErr) {
    console.error('❌ Error fetching settlement:', settlErr.message);
    return;
  }

  if (!settlements || settlements.length === 0) {
    console.log('⚠️  No settlement row found for this order');
    return;
  }

  const settlement = settlements[0];
  console.log('✓ Settlement found!');
  console.log('\nSettlement columns and values:');

  Object.entries(settlement).forEach(([col, val]) => {
    if (col === 'raw_response') {
      console.log(`   - ${col}: [JSONB, see below]`);
    } else if (val === null) {
      console.log(`   - ${col}: null`);
    } else if (typeof val === 'object') {
      console.log(`   - ${col}: ${JSON.stringify(val).slice(0, 100)}...`);
    } else {
      console.log(`   - ${col}: ${val}`);
    }
  });

  // Step 4: Analyze raw_response for GMV-related fields
  console.log('\n\nStep 4: Analyzing raw_response for GMV/fee fields...\n');

  if (settlement.raw_response && typeof settlement.raw_response === 'object') {
    const raw = settlement.raw_response;
    console.log('raw_response structure:');
    console.log(JSON.stringify(raw, null, 2));

    // Search for any field that might be 1.10
    console.log('\n\nStep 5: Searching for field value 1.10...\n');

    function findValue(obj, target, path = []) {
      const results = [];

      if (obj === null || obj === undefined) return results;

      if (typeof obj === 'number') {
        // Check if this number is close to 1.10
        if (Math.abs(obj - 1.10) < 0.01) {
          results.push({
            path: path.join('.'),
            value: obj,
            type: typeof obj
          });
        }
      } else if (typeof obj === 'string') {
        if (obj === '1.10' || obj === '1.1' || parseFloat(obj) === 1.10) {
          results.push({
            path: path.join('.'),
            value: obj,
            type: typeof obj
          });
        }
      } else if (typeof obj === 'object' && obj !== null) {
        if (Array.isArray(obj)) {
          obj.forEach((item, idx) => {
            results.push(...findValue(item, target, [...path, `[${idx}]`]));
          });
        } else {
          Object.entries(obj).forEach(([key, val]) => {
            results.push(...findValue(val, target, [...path, key]));
          });
        }
      }

      return results;
    }

    const matches = findValue(raw, 1.10);

    if (matches.length > 0) {
      console.log('✓ Found values matching 1.10:');
      matches.forEach(match => {
        console.log(`   Path: ${match.path}`);
        console.log(`   Value: ${match.value} (type: ${match.type})`);
        console.log('');
      });
    } else {
      console.log('❌ No values matching 1.10 found in raw_response');
    }

    // Step 6: List all fields with "gmv", "max", "ad", "fee" keywords
    console.log('\n\nStep 6: Searching for relevant keywords (gmv, max, ad, fee)...\n');

    function findKeywords(obj, keywords, path = []) {
      const results = [];

      if (obj === null || obj === undefined) return results;

      if (typeof obj === 'object' && obj !== null) {
        if (Array.isArray(obj)) {
          obj.forEach((item, idx) => {
            results.push(...findKeywords(item, keywords, [...path, `[${idx}]`]));
          });
        } else {
          Object.entries(obj).forEach(([key, val]) => {
            const keyLower = key.toLowerCase();

            // Check if key contains any keyword
            if (keywords.some(kw => keyLower.includes(kw))) {
              results.push({
                path: [...path, key].join('.'),
                key: key,
                value: val,
                type: typeof val
              });
            }

            // Recurse
            results.push(...findKeywords(val, keywords, [...path, key]));
          });
        }
      }

      return results;
    }

    const keywords = ['gmv', 'max', 'ad', 'fee', 'ads', 'shop'];
    const keywordMatches = findKeywords(raw, keywords);

    if (keywordMatches.length > 0) {
      console.log(`✓ Found ${keywordMatches.length} fields matching keywords:\n`);
      keywordMatches.forEach(match => {
        console.log(`   Field: ${match.path}`);
        console.log(`   Key: ${match.key}`);
        console.log(`   Value: ${JSON.stringify(match.value)}`);
        console.log(`   Type: ${match.type}\n`);
      });
    } else {
      console.log('❌ No fields matching keywords found');
    }
  } else {
    console.log('❌ raw_response is not available or not an object');
  }

  // Step 7: List statement_transactions structure if available
  console.log('\n\nStep 7: Analyzing statement_transactions structure...\n');

  if (settlement.raw_response?.statement_transactions && Array.isArray(settlement.raw_response.statement_transactions)) {
    const txns = settlement.raw_response.statement_transactions;
    console.log(`✓ Found ${txns.length} transaction(s)`);

    if (txns.length > 0) {
      console.log('\nFirst transaction fields:');
      Object.keys(txns[0]).forEach(field => {
        console.log(`   - ${field}: ${typeof txns[0][field]}`);
      });

      console.log('\nFirst transaction data:');
      console.log(JSON.stringify(txns[0], null, 2));
    }
  } else {
    console.log('⚠️  No statement_transactions array found');
  }
}

await investigateGmvFee();
