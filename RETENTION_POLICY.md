# Data Retention Policy - 60 Day Rolling Window

## Overview

Starting from this release, the MotoParts ERP system implements a **60-day rolling data retention policy** to manage Supabase storage within the free tier limits (5M rows).

**Policy:** Delete completed orders older than 60 days. Keep all incomplete orders regardless of age.

## What Gets Deleted

### Every 24 hours (at 2 AM UTC):

1. **Orders** — rows from `orders` table where:
   - `order_status = 'completed'`
   - `created_at < 60 days ago`

2. **Order Items** — all `order_items` associated with deleted orders

3. **Sync Logs** — rows from `sync_logs` older than 60 days (historical record cleanup)

### What Gets Kept

- ✅ All orders created within the last 60 days (completed or not)
- ✅ Any incomplete/pending orders (regardless of age) — never auto-deleted
- ✅ Recent sync logs (last 60 days)
- ✅ All product listings, inventory, user data, platform accounts

## Deployment

### Automatic Deployment

1. **Function Deployment** (`.github/workflows/deploy-functions.yml`)
   - Automatically triggers when `supabase/functions/cleanup-old-orders/index.ts` changes
   - Requires: `SUPABASE_ACCESS_TOKEN` secret

2. **Daily Cleanup** (`.github/workflows/cleanup-old-orders.yml`)
   - Runs every day at **2:00 AM UTC** (10 AM UTC+8)
   - Can also be triggered manually via GitHub Actions UI
   - Requires: `SUPABASE_ANON_KEY` and `SUPABASE_PROJECT_REF` secrets

### Manual Testing

Test the cleanup function without deleting data:

```bash
# Dry run (preview what would be deleted)
curl -X POST \
  https://your-project.supabase.co/functions/v1/cleanup-old-orders \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "dryRun": true,
    "retentionDays": 60
  }'

# Real execution (actually deletes data)
curl -X POST \
  https://your-project.supabase.co/functions/v1/cleanup-old-orders \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "dryRun": false,
    "retentionDays": 60
  }'
```

## Expected Storage Impact

### Before Cleanup
- Accumulates ~60+ days of orders
- Older than 60 days: 100+ days of historical data
- Can exceed 5M row free tier limit

### After 60-Day Policy
- Rolling window: always ~60 days of completed orders
- Maximum storage: typically 60 × (avg daily orders) + extras
- If you average 5,000 orders/day: ~300K rows for orders alone
- Well within 5M free tier limit

## Retention Period Adjustment

If you need to change the retention period (e.g., 30 days or 90 days):

1. Edit `.github/workflows/cleanup-old-orders.yml`
2. Change `"retentionDays": 60` to your preferred value
3. Commit and push

Or test locally via curl with `"retentionDays": 30` etc.

## FAQ

**Q: What if I need to keep completed orders longer than 60 days?**
A: Manual archive them before the window closes, or adjust `retentionDays` in the cron job.

**Q: Will incomplete orders ever be deleted?**
A: No. The policy only deletes completed orders. Any order with status != 'completed' is kept indefinitely.

**Q: Can I restore deleted data?**
A: No — the edge function performs hard deletes. If you need archival/recovery, implement a backup strategy separately.

**Q: How much storage will this save?**
A: Depends on order volume. For typical shops (~5K orders/day):
- Before: ~6M rows (older than 60d) → exceeds limit
- After: ~300K rows (last 60d) → safe within 5M limit

**Q: Does this affect sync_logs or platform_accounts?**
A: Only `sync_logs` older than 60 days are deleted. `platform_accounts`, `orders`, and other core data are managed by the retention policy independently.

## Monitoring

Check cleanup job results in Supabase Dashboard:
1. Go to **Edge Functions** → `cleanup-old-orders`
2. View **Logs** tab for recent invocations
3. Search `sync_logs` table for entries with `action='cleanup_old_orders'`

## Implementation Details

- **File**: `supabase/functions/cleanup-old-orders/index.ts`
- **Trigger**: GitHub Actions cron (daily 2 AM UTC)
- **Safe mode**: Logs all deletions to `sync_logs` for audit trail
- **Error handling**: Catches and logs failures without crashing
