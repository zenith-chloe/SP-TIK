#!/usr/bin/env node
/**
 * Full TikTok Shop order sync - populates fulfillment_status
 *
 * Usage:
 *   SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=... node scripts/run-full-sync.js
 */

const https = require('https');
const url = require('url');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Error: Missing environment variables\n');
  console.error('Please set:');
  console.error('  export SUPABASE_URL="https://your-project.supabase.co"');
  console.error('  export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"');
  console.error('');
  process.exit(1);
}

console.log('🔄 Starting full TikTok Shop order sync...\n');
console.log('This will:');
console.log('  • Walk entire order history by create_time DESC');
console.log('  • Populate fulfillment_status for DELIVERED/COMPLETED/delivery_failed');
console.log('  • Resume from checkpoint if interrupted\n');
console.log(`📍 Supabase URL: ${SUPABASE_URL}\n`);

const urlObj = new url.URL(`${SUPABASE_URL}/functions/v1/tiktok-sync-orders`);

const options = {
  hostname: urlObj.hostname,
  port: urlObj.port,
  path: urlObj.pathname + urlObj.search,
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Content-Length': 19,
  },
};

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('Response:\n');
    try {
      const parsed = JSON.parse(data);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log(data);
    }
    console.log('\n✅ Sync request submitted!\n');
    console.log('📊 Monitor sync progress in:\n');
    console.log('  - Supabase Dashboard > SQL Editor');
    console.log('    SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT 20');
    console.log('');
    console.log('  - Or check resumable state:');
    console.log('    SELECT * FROM platform_sync_progress');
    console.log('');
  });
});

req.on('error', (e) => {
  console.error(`❌ Error: ${e.message}`);
  process.exit(1);
});

req.write('{"fullSync":true}');
req.end();
