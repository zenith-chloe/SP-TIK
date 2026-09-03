# GitHub Actions Setup - Copy & Paste Guide

Since GitHub requires `workflow` scope to create workflow files via API, use this manual setup guide instead.

## Step 1: Add GitHub Secrets

1. Go to your repository on GitHub
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** and add these three:

| Secret Name | Value | Where to find |
|-------------|-------|----------------|
| `SUPABASE_PROJECT_REF` | Your project reference (e.g., `abcdefghijklmnop`) | Supabase Dashboard → Settings → General → Project Reference |
| `SUPABASE_ANON_KEY` | Your public anon key | Supabase Dashboard → Settings → API → `anon` key (public) |
| `SUPABASE_ACCESS_TOKEN` | Your personal access token | https://supabase.com/dashboard/account/tokens → Create New Token |

## Step 2: Create Workflow Files

### Method A: GitHub Web UI (Easiest)

1. Go to your repository
2. Click **Actions** tab
3. Click **New workflow** → **set up a workflow yourself**
4. Copy the workflow content below into the editor
5. Click **Commit changes**

### Method B: Clone and Push

```bash
# Clone repo if not already cloned
git clone https://github.com/your-username/SP-TIK.git
cd SP-TIK

# Create workflow directory
mkdir -p .github/workflows

# Copy workflow files (use content below)
# Then commit and push
git add .github/workflows/
git commit -m "feat: Add GitHub Actions for cleanup automation"
git push origin main
```

## Workflow 1: Daily Cleanup

**File:** `.github/workflows/cleanup-old-orders.yml`

```yaml
name: Daily Cleanup - Delete Orders Older Than 60 Days

on:
  schedule:
    # Runs every day at 2:00 AM UTC (10 AM UTC+8)
    - cron: '0 2 * * *'
  # Allow manual trigger from GitHub Actions UI
  workflow_dispatch:
    inputs:
      dryRun:
        description: 'Dry run (no actual deletion)?'
        required: false
        type: boolean
        default: false
      retentionDays:
        description: 'Retention days (default: 60)'
        required: false
        type: string
        default: '60'

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Run cleanup-old-orders function
        run: |
          echo "Starting cleanup job..."
          echo "Retention: 60 days"
          echo "Deleting: completed orders older than 60 days"
          
          RESPONSE=$(curl -X POST \
            https://${{ secrets.SUPABASE_PROJECT_REF }}.supabase.co/functions/v1/cleanup-old-orders \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_ANON_KEY }}" \
            -H "Content-Type: application/json" \
            -d '{
              "dryRun": false,
              "retentionDays": 60
            }')
          
          echo "Response: $RESPONSE"
          
          # Check if successful
          if echo "$RESPONSE" | grep -q '"success":true'; then
            echo "✅ Cleanup completed successfully"
          else
            echo "❌ Cleanup failed"
            exit 1
          fi

      - name: Log completion
        if: success()
        run: |
          echo "Cleanup job finished successfully"
          echo "Deleted: completed orders, associated items, old sync_logs"
          echo "Next run: Tomorrow at 2 AM UTC"
```

**What it does:**
- Runs automatically every day at 2 AM UTC (10 AM UTC+8)
- Deletes completed orders older than 60 days
- Keeps all incomplete orders
- Cleans up old sync_logs
- Can be triggered manually from GitHub Actions UI

## Workflow 2: Deploy Function on Code Changes

**File:** `.github/workflows/deploy-functions.yml`

```yaml
name: Deploy Supabase Functions

on:
  push:
    branches:
      - main
    paths:
      - 'supabase/functions/**'
      - '.github/workflows/deploy-functions.yml'
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Set up Deno
        uses: denoland/setup-deno@v1
        with:
          deno-version: vx.x.x

      - name: Install Supabase CLI
        run: npm install -g supabase

      - name: Deploy cleanup-old-orders function
        run: |
          supabase functions deploy cleanup-old-orders \
            --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}

      - name: Verify deployment
        run: |
          echo "✅ Function deployed successfully"
          echo "Function: cleanup-old-orders"
          echo "Project: ${{ secrets.SUPABASE_PROJECT_REF }}"
```

**What it does:**
- Auto-deploys `cleanup-old-orders` function when you push changes
- Only triggers on changes to `supabase/functions/` directory
- Can be triggered manually from GitHub Actions UI

## Step 3: Verify Setup

1. Go to **Actions** tab in your GitHub repository
2. You should see two workflows:
   - `Daily Cleanup - Delete Orders Older Than 60 Days`
   - `Deploy Supabase Functions`
3. Click on a workflow to view its configuration

## Step 4: Test the Setup

### Option A: Test via GitHub Actions UI

1. Go to **Actions** → **Daily Cleanup - Delete Orders Older Than 60 Days**
2. Click **Run workflow** → **Run workflow**
3. Wait for it to complete (2-5 minutes)
4. Click the job to see logs

### Option B: Test via Command Line

```bash
# Test dry run (preview what would be deleted)
curl -X POST \
  https://YOUR_PROJECT_REF.supabase.co/functions/v1/cleanup-old-orders \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true, "retentionDays": 60}'

# Real run (actually delete data)
curl -X POST \
  https://YOUR_PROJECT_REF.supabase.co/functions/v1/cleanup-old-orders \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false, "retentionDays": 60}'
```

## Monitoring

### View Cleanup Logs

1. GitHub: Go to **Actions** → **Daily Cleanup** → click recent run
2. Supabase: Go to **Edge Functions** → `cleanup-old-orders` → **Logs** tab

### Query Cleanup Records

```sql
-- Check cleanup history in Supabase
SELECT 
  created_at,
  action,
  status,
  message
FROM sync_logs
WHERE action = 'cleanup_old_orders'
ORDER BY created_at DESC
LIMIT 20;
```

## Troubleshooting

### Workflow doesn't run on schedule

1. Check that workflows are enabled:
   - Go to **Actions** tab
   - If you see a message, click to enable workflows
2. GitHub Actions needs at least one workflow run on `main` branch first
3. Scheduled workflows run at specified time (may take up to 15 min to trigger)

### "Unauthorized" error in workflow

Check that secrets are set correctly:
```bash
# List secrets (values are hidden)
gh secret list -R zenith-chloe/SP-TIK
```

### Function not found error

Ensure `cleanup-old-orders` is deployed:
```bash
supabase functions list --project-ref YOUR_PROJECT_REF
```

If not listed, run:
```bash
./scripts/setup-cleanup.sh
```

## Schedule Adjustment

Want cleanup at a different time? Edit the cron expression:

Current: `0 2 * * *` (2 AM UTC)

Examples:
- `0 0 * * *` = Midnight UTC (8 AM UTC+8)
- `0 12 * * *` = Noon UTC (8 PM UTC+8)
- `30 2 * * *` = 2:30 AM UTC (10:30 AM UTC+8)

[Cron format help](https://crontab.guru/)

## Questions?

See full documentation:
- `RETENTION_POLICY.md` — Policy details
- `SETUP_CLEANUP.md` — Step-by-step setup guide
