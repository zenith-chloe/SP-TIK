#!/bin/bash
# Full TikTok Shop order sync script
# Populates fulfillment_status field for all orders

set -e

echo "🔄 Starting full TikTok Shop order sync..."
echo ""
echo "This will:"
echo "  • Walk entire order history by create_time DESC"
echo "  • Populate fulfillment_status for DELIVERED/COMPLETED/delivery_failed"
echo "  • Resume from checkpoint if interrupted"
echo ""

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "❌ Error: Missing environment variables"
  echo ""
  echo "Please set:"
  echo "  export SUPABASE_URL='your-supabase-url'"
  echo "  export SUPABASE_SERVICE_ROLE_KEY='your-service-role-key'"
  echo ""
  exit 1
fi

echo "📍 Supabase URL: $SUPABASE_URL"
echo ""

# Invoke the Edge Function with fullSync flag
RESPONSE=$(curl -s -X POST \
  "$SUPABASE_URL/functions/v1/tiktok-sync-orders" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"fullSync": true}')

echo "Response:"
echo "$RESPONSE" | jq '.' || echo "$RESPONSE"
echo ""
echo "✅ Sync request submitted!"
echo ""
echo "📊 Monitor sync progress in:"
echo "  - Supabase Dashboard > SQL Editor > SELECT * FROM sync_logs ORDER BY created_at DESC"
echo "  - Or check platform_sync_progress table for resumable state"
echo ""
