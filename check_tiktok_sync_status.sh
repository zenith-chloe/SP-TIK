#!/bin/bash
# Quick status check for TikTok sync
# Run this anytime to see current progress

SUPABASE_URL="https://dtttdgdkhayzchmfptjt.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY"
SYNC_SECRET="4f032ead5eaafcd8fdb9538d947b9acf6a952cfed11b9caaa73995f8aa4accfa"

echo "🔍 TikTok Sync Status Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

RESPONSE=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/tiktok-sync-orders" \
  -H "Authorization: Bearer ${ANON_KEY}" \
  -H "apikey: ${ANON_KEY}" \
  -H "x-sync-secret: ${SYNC_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{}' 2>/dev/null)

echo "Current Sync Status:"
echo "───────────────────────────────────────────────"
echo "$RESPONSE" | jq '.results[0] | {
  mode,
  fullSyncDone,
  syncedOrders,
  pages,
  truncated
}'

echo ""
echo "Interpretation:"
DONE=$(echo "$RESPONSE" | jq -r '.results[0].fullSyncDone' 2>/dev/null)
if [ "$DONE" = "true" ]; then
  echo "✅ SYNC COMPLETE - Orders have been synced"
  echo "   Check your ERP to verify the count is now 48 awaiting shipment"
else
  echo "⏳ SYNC IN PROGRESS - Still fetching orders from TikTok"
  echo "   Run this command again in a few minutes to check progress"
fi

echo ""
echo "Next Step When Complete:"
echo "───────────────────────────────────────────────"
echo "1. Log into ERP at: https://motoparts-erp.vercel.app"
echo "2. Go to Orders page"
echo "3. Check 'Awaiting Shipment' count - should be 48 ✓"
