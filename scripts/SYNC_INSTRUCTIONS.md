# Full TikTok Shop Order Sync

This guide explains how to run a full order sync to populate the `fulfillment_status` field for all existing and new TikTok Shop orders.

## What It Does

- Walks entire TikTok order history by `create_time DESC`
- Captures `fulfillment_status` mapping:
  - `DELIVERED` → `"delivered"`
  - `COMPLETED` → `"completed"`
  - `CANCELLED` (with delivery_failed reason) → `"delivery_failed"`
  - Others → `null`
- Resumable: checkpoints after each page so it survives interruptions
- Two-phase sync: Full walk + compensation walk to catch orders created during sync

## Prerequisites

Get credentials from Supabase Dashboard:
1. Go to **Settings > API**
2. Copy:
   - **Project URL** (SUPABASE_URL)
   - **Service Role Key** (SUPABASE_SERVICE_ROLE_KEY) - ⚠️ keep this secret

## Option 1: Node.js Script (Recommended)

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
node scripts/run-full-sync.js
```

## Option 2: Bash Script

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
bash scripts/run-full-sync.sh
```

## Option 3: cURL

```bash
curl -X POST \
  "https://your-project.supabase.co/functions/v1/tiktok-sync-orders" \
  -H "Authorization: Bearer your-service-role-key" \
  -H "Content-Type: application/json" \
  -d '{"fullSync": true}'
```

## Monitoring Progress

Watch sync progress in Supabase:

```sql
-- Latest sync logs
SELECT action, status, message, created_at 
FROM sync_logs 
WHERE action = 'tiktok_sync_shop'
ORDER BY created_at DESC 
LIMIT 20;

-- Resumable sync state (Phase 1 = full walk, Phase 2 = compensation)
SELECT account_id, sync_type, status, pages_fetched, orders_synced, updated_at
FROM platform_sync_progress
ORDER BY updated_at DESC;

-- Orders with fulfillment_status
SELECT order_no, order_status, fulfillment_status, platform_status
FROM orders 
WHERE platform = 'tiktok' AND fulfillment_status IS NOT NULL
LIMIT 10;
```

## Time Estimate

- Full history (hundreds to thousands of orders)
- ~1-10 minutes depending on order volume
- Can be interrupted and resumed safely

## After Sync

1. Orders will display `fulfillment_status` badge in Order Management Center
2. Filtering to "已送达" (Delivered) / "已完成" (Completed) / "投递失败" (Delivery Failed) will show fulfillment status details
3. New syncs automatically update fulfillment_status for changed orders

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Access denied" | Check Service Role Key is correct and has access |
| "function not found" | Ensure `tiktok-sync-orders` function is deployed |
| Long-running | Check `platform_sync_progress` table to see current phase |
| Stuck at 0 orders | Verify TikTok shop is connected in `platform_accounts` |

## Questions?

Check:
- `sync_logs` table for detailed error messages
- `platform_sync_progress` table for resumable state
- Edge Function logs in Supabase Dashboard
