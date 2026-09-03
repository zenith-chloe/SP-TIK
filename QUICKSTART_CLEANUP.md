# Quick Start: 60-Day Data Retention Cleanup

**TL;DR** — Delete old orders to stay within Supabase 5M row free tier.

## 🚀 3-Minute Setup

### 1. Deploy the function (1 min)

```bash
# Install/login if needed
npm install -g supabase
supabase login

# Deploy (replace with your project ref)
supabase functions deploy cleanup-old-orders --project-ref your_project_ref
```

### 2. Add GitHub Actions (2 min)

1. Open GitHub repo → **Actions** tab
2. Click **New workflow** → **set up a workflow yourself**
3. Copy from `GITHUB_ACTIONS_SETUP.md` → paste both workflows
4. Commit

Alternatively: Run manually once a day:

```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/cleanup-old-orders \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false, "retentionDays": 60}'
```

## ✅ What It Does

| Action | Details |
|--------|---------|
| **Deletes** | Orders with status='completed' AND age > 60 days |
| **Keeps** | All incomplete orders (any age) + recent data |
| **Cleans** | Old sync_logs, keeps operational records |
| **Runs** | Daily at 2 AM UTC (automatic) |

## 📊 Expected Results

| Metric | Before | After |
|--------|--------|-------|
| Order age | 100+ days | 60 day rolling |
| Total rows | 6M+ ❌ | ~300K ✅ |
| Status | Over limit | Safe |

(Assumes ~5K orders/day average)

## 🔍 Test First (Recommended)

```bash
# Preview what would be deleted (no actual deletion)
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/cleanup-old-orders \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true, "retentionDays": 60}'
```

## 📋 Files for Reference

| File | Purpose |
|------|---------|
| `supabase/functions/cleanup-old-orders/index.ts` | The cleanup function |
| `RETENTION_POLICY.md` | Full policy documentation |
| `SETUP_CLEANUP.md` | Detailed setup guide |
| `GITHUB_ACTIONS_SETUP.md` | GitHub Actions workflows (copy-paste) |
| `scripts/setup-cleanup.sh` | Automated deployment script |

## ❓ Common Questions

**Q: Will this delete my data?**
A: Only completed orders older than 60 days. Test with `dryRun: true` first.

**Q: What about incomplete orders?**
A: Kept forever. Only completed orders → deleted after 60 days.

**Q: How often does it run?**
A: Daily at 2 AM UTC. Change it in the GitHub Actions workflow.

**Q: Can I undo a deletion?**
A: No. Test with dry run first. Supabase backups are separate.

**Q: What's the storage saving?**
A: ~95% reduction if you have 100+ days of data.

## 🆘 Need Help?

1. **Dry run first**: Always test with `dryRun: true`
2. **Check logs**: Supabase Dashboard → Edge Functions → cleanup-old-orders
3. **Read full docs**: See `RETENTION_POLICY.md`
4. **Setup guide**: See `SETUP_CLEANUP.md` for step-by-step

## Next Steps

1. ✅ Run dry test: `dryRun: true, retentionDays: 60`
2. ✅ Check results in sync_logs table
3. ✅ Deploy GitHub Actions (optional but recommended)
4. ✅ Monitor logs after first real run

---

**Status**: ✅ Ready to deploy
**Risk Level**: 🟢 Low (test with dry run first)
**Impact**: Reduces storage cost + keeps system running within free tier
