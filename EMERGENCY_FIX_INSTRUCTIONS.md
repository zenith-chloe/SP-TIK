# 🚨 EMERGENCY FIX: Latest Orders Not Syncing

## The Problem
- **Full sync is stuck on Phase 1** (walking through 2,000+ historical orders)
- **Incremental sync is blocked** because `last_synced_at` is still NULL
- **New orders from the last 24 hours are NOT being picked up** (5 new orders: 49-44=5)
- **ERP is stuck at 44 awaiting shipment**

## Root Cause
The sync architecture has a gap:
1. Full sync starts (Phase 1)
2. New orders are created on TikTok (49 vs 48 awaiting shipment)
3. Incremental sync can't run because `last_synced_at` is NULL
4. Phase 2 (compensation) won't run until Phase 1 completes

## The Solution: Force Incremental Sync for Last 24 Hours

### Option 1: I Run The Fix (Recommended - Fastest)
**Provide your Supabase Service Role Key, and I'll run this immediately.**

To get it:
1. Go to: https://app.supabase.com/project/dtttdgdkhayzchmfptjt/settings/api
2. Copy the **Service Role Key** (under "Project API keys")
3. Paste it here or send it securely

Then I can execute the fix in seconds.

---

### Option 2: You Run The Fix Script Locally
**File:** `EMERGENCY_FIX_sync_latest_orders.mjs`

#### Setup:
```bash
# 1. Go to Supabase dashboard and get your Service Role Key
# https://app.supabase.com/project/dtttdgdkhayzchmfptjt/settings/api

# 2. Set the environment variable (replace with your actual key)
export SUPABASE_SERVICE_KEY="your-service-role-key-here"

# 3. Run the script
cd /Users/chloechun/Desktop/SP-TIK
node EMERGENCY_FIX_sync_latest_orders.mjs
```

#### What It Does:
1. ✅ Gets your TikTok platform account
2. ✅ Updates `last_synced_at` to 24 hours ago
3. ✅ Triggers incremental sync for that time window
4. ✅ Fetches all orders from last 24 hours (catches the 5 new ones)
5. ✅ ERP automatically reflects the new count (49 awaiting shipment)

#### Expected Output:
```
✓ Found: [Your TikTok Account]
✓ Updated last_synced_at to 24 hours ago
✓ Sync triggered successfully
  - Mode: incremental
  - Orders synced: 5+
✨ EMERGENCY FIX COMPLETE
```

---

### Option 3: Manual Fix via Supabase Dashboard
**If you prefer not to share the key:**

1. Go to: https://app.supabase.com/project/dtttdgdkhayzchmfptjt
2. Navigate to: **SQL Editor** → **New Query**
3. Paste this SQL:

```sql
-- Update last_synced_at to 24 hours ago to enable incremental sync
UPDATE platform_accounts 
SET last_synced_at = NOW() - INTERVAL '24 hours'
WHERE platform = 'tiktok'
RETURNING id, account_name, last_synced_at;
```

4. Click **Run**
5. Then run the sync manually or wait for cron to trigger it

**Note:** After running this, the cron job will automatically trigger an incremental sync within 1 minute, fetching all orders from the last 24 hours.

---

## What Happens After Fix

### Immediately After:
```
✅ Incremental sync fetches orders from last 24 hours
✅ 5 new orders are synced into database
✅ ERP counts update automatically:
   - Awaiting Shipment: 44 → 49 ✓
   - Awaiting Collection: 1 → 1 ✓
   - Total To Ship: 45 → 50 ✓
```

### Going Forward:
```
✅ Incremental sync runs every minute (via cron)
✅ New orders appear in ERP within 60 seconds
✅ Future orders synced in real-time
✅ Full sync continues to completion in background (catches any edge cases)
```

---

## Why This Works

**Before Fix:**
```
Full Sync Phase 1 (running)
  ↓
last_synced_at = NULL (blocked)
  ↓
Incremental Sync = BLOCKED (can't run)
  ↓
New Orders = MISSED ❌
```

**After Fix:**
```
Full Sync Phase 1 (still running in background)
  ↓
last_synced_at = 24 hours ago (set manually)
  ↓
Incremental Sync = ENABLED (fetches recent orders)
  ↓
New Orders = CAUGHT ✅
```

---

## Timeline to Resolution

| Step | Action | Time |
|------|--------|------|
| 1 | Run fix (Option 1/2/3) | Immediate |
| 2 | Incremental sync fetches new orders | 0-30 sec |
| 3 | Orders written to database | 30-60 sec |
| 4 | ERP refreshes and shows new count | 1-2 min |
| 5 | Verification complete | ✅ Done |

---

## Safety Notes

✅ **Safe Operations:**
- Only updating `last_synced_at` (a timestamp, non-critical field)
- Incremental sync fetches orders by `update_time_ge` (standard operation)
- No data deletion or overwriting
- Idempotency guaranteed by existing UNIQUE constraints

✅ **No Duplicates:**
- Supabase UNIQUE constraints prevent duplicate inserts
- Orders identified by (platform, order_no)
- Safe to run multiple times

---

## Questions?

**What if the fix doesn't work?**
- The full sync will complete eventually and Phase 2 will catch everything
- Multiple syncs are safe - they won't create duplicates
- Can run the fix script multiple times without harm

**Can I run the fix while full sync is running?**
- Yes, completely safe
- Doesn't interrupt the full sync
- Starts a parallel incremental sync stream

**How do I know it worked?**
1. Log into ERP: https://motoparts-erp.vercel.app
2. Refresh the Orders page
3. Check the "待发货" count
4. Should show 49 (was 44)

---

## Next: Choose Your Option

**Fastest (me):** Share your Service Role Key → I'll run the fix
**Safe:** Run the script locally with your own key
**Manual:** Use the SQL query in Supabase dashboard

Choose one and let me know! ⚡
