import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkAllSettlements() {
  console.log('\n🔍 === ALL SETTLEMENTS IN DATABASE ===\n');
  
  const { data } = await supabase
    .from('order_settlements')
    .select('*');

  if (!data || data.length === 0) {
    console.log('❌ No settlements at all');
    return;
  }

  console.log(`✓ Found ${data.length} settlement(s)\n`);

  data.forEach(s => {
    console.log(`Order: ${s.order_no}`);
    console.log(`Platform: ${s.platform}`);
    console.log(`Synced: ${s.synced_at}`);
    console.log(`Has raw_response: ${s.raw_response ? '✓ YES' : '✗ NO'}`);
    
    if (s.raw_response) {
      const keys = Object.keys(s.raw_response);
      console.log(`raw_response keys: ${keys.join(', ')}`);
    }
    console.log('---\n');
  });
}

await checkAllSettlements();
