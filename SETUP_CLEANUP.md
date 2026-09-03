# Setup Guide: 60-Day Data Retention Cleanup

## Summary

A new Edge Function `cleanup-old-orders` has been added to automatically delete completed orders older than 60 days. This keeps your Supabase database within the 5M row free tier limit.

## Files Added

- `supabase/functions/cleanup-old-orders/index.ts` — The cleanup function
- `RETENTION_POLICY.md` — Full documentation of the retention policy

## Step 1: Deploy the Edge Function

### Option A: Deploy via Supabase CLI (Recommended)

```bash
# First, login to Supabase
supabase login

# Deploy the function
supabase functions deploy cleanup-old-orders --project-ref your-project-ref
```

Get your `project-ref` from Supabase Dashboard → Settings → General

### Option B: Deploy via Supabase Web Dashboard

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **Edge Functions** section
4. Click **Create a new function**
5. Name it `cleanup-old-orders`
6. Copy the contents of `supabase/functions/cleanup-old-orders/index.ts`
7. Paste and deploy

## Step 2: Set Up Automated Daily Cleanup (GitHub Actions)

To enable daily automatic cleanup at 2 AM UTC, add GitHub Actions workflow files:

### Create `.github/workflows/cleanup-old-orders.yml`

```yaml
name: Daily Cleanup - Delete Orders Older Than 60 Days

on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM UTC
  workflow_dispatch:

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Cleanup old orders
        run: |
          curl -X POST \
            https://${{ secrets.SUPABASE_PROJECT_REF }}.supabase.co/functions/v1/cleanup-old-orders \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_ANON_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{"dryRun": false, "retentionDays": 60}'
```

### Create `.github/workflows/deploy-functions.yml`

```yaml
name: Deploy Supabase Functions

on:
  push:
    branches: [main]
    paths:
      - 'supabase/functions/**'
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: denoland/setup-deno@v1
      - run: npm install -g supabase
      - run: |
          supabase functions deploy cleanup-old-orders \
            --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
```

### Add GitHub Secrets

Go to GitHub → Settings → Secrets and variables → Actions:

1. `SUPABASE_PROJECT_REF` — Your Supabase project reference
   - Found in Supabase Dashboard → Settings → General

2. `SUPABASE_ANON_KEY` — Your Supabase anon key
   - Found in Supabase Dashboard → Settings → API

3. `SUPABASE_ACCESS_TOKEN` — Your Supabase personal access token
   - Create at https://supabase.com/dashboard/account/tokens

**Note:** GitHub requires `workflow` scope permission to create workflow files. If you encounter permission errors, you'll need to re-authenticate with that scope or contact your GitHub organization admin.

## Step 3: Test the Cleanup Function

### Test without deleting data (dry run)

```bash
curl -X POST \
  https://YOUR_PROJECT.supabase.co/functions/v1/cleanup-old-orders \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true, "retentionDays": 60}'
```

Expected response:
```json
{
  "success": true,
  "timestamp": "2026-09-03T...",
  "retentionDays": 60,
  "deletedOrders": 0,
  "deletedOrderItems": 0,
  "deletedSyncLogs": 0,
  "dryRun": true,
  "message": "..."
}
```

### Test with actual deletion

```bash
curl -X POST \
  https://YOUR_PROJECT.supabase.co/functions/v1/cleanup-old-orders \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false, "retentionDays": 60}'
```

## Step 4: Monitor Cleanup Jobs

### View Function Logs

1. Go to Supabase Dashboard
2. Click **Edge Functions** → `cleanup-old-orders`
3. View **Logs** tab for recent invocations

### Check Cleanup Records

Query `sync_logs` table for cleanup activities:

```sql
SELECT * FROM sync_logs 
WHERE action = 'cleanup_old_orders' 
ORDER BY created_at DESC 
LIMIT 10;
```

## What Gets Deleted

**Every 24 hours:**
- ✅ `orders` where `order_status = 'completed'` AND `created_at < 60 days ago`
- ✅ Associated `order_items` for those orders
- ✅ `sync_logs` older than 60 days

**Never deleted:**
- ✅ Orders created within last 60 days (any status)
- ✅ Any incomplete orders (status ≠ 'completed') — kept indefinitely
- ✅ All product listings, inventory, users, platform accounts

## Expected Storage Impact

**Before cleanup:** Accumulates 100+ days of data → exceeds 5M row free tier
**After cleanup:** Maintains rolling 60-day window → stays within limits

If you average 5,000 orders/day:
- 60 days × 5,000 = 300K order rows + items ✅ Safe

## Troubleshooting

### "Function not found" error

The Edge Function may not be deployed yet. Run:
```bash
supabase functions deploy cleanup-old-orders
```

### "Unauthorized" error

Check that:
1. `SUPABASE_ANON_KEY` is correct (from Supabase Dashboard → Settings → API)
2. `Authorization: Bearer` header format is correct
3. Project reference matches

### GitHub workflow stuck

If the scheduled cleanup doesn't run:
1. Check GitHub Actions logs: Go to your repo → Actions
2. Verify secrets are set correctly
3. Make sure `SUPABASE_ACCESS_TOKEN` has `functions:deploy` scope

### Too many rows still getting deleted?

Adjust `retentionDays` in the workflow:
```yaml
-d '{"dryRun": false, "retentionDays": 90}'  # Keep 90 days instead
```

## Questions?

Refer to `RETENTION_POLICY.md` for full documentation.
