# Order Count Verification & Full Sync Guide

## Issue Summary
**Count Mismatch Detected:**
- TikTok Platform: Awaiting Shipment = 36, In Transit = 60, Delivered = 426
- ERP System (before fix): Awaiting Shipment = 29, In Transit = 68

**Root Cause:** TikTok instant orders (7 orders) were being excluded from the "待发货" (To Ship) count, but they should be included because they ARE real AWAITING_SHIPMENT orders on TikTok.

**Fix Applied:** Updated filter logic in `pagesOverviewOrders.jsx` to only exclude instant orders for Shopee, not TikTok.

---

## Verification Steps

### Step 1: Verify Filter Fix in Code
The filter now correctly handles instant orders:
```javascript
// TikTok includes instant orders in toShip count (they're real AWAITING_SHIPMENT)
// Shopee excludes instant orders (they have their own card)
isShopee ? excludeInstant(...) : base().in("platform_status", ["AWAITING_SHIPMENT", ...])
```

✅ This matches TikTok API definition: awaiting_shipment includes all orders pending shipment

### Step 2: Check Current Database Counts
Run diagnostic SQL to see current state:

```sql
-- Copy this from: scripts/check-order-counts.sql
-- Paste into Supabase Dashboard > SQL Editor

-- Check awaiting shipment (should be ~36 after sync)
SELECT COUNT(*) as awaiting_shipment_total
FROM orders 
WHERE platform = 'tiktok' 
  AND platform_status = 'AWAITING_SHIPMENT';

-- Check in transit (should be ~60)
SELECT COUNT(*) as in_transit_total
FROM orders 
WHERE platform = 'tiktok' 
  AND platform_status IN ('IN_TRANSIT', 'SHIPPED');

-- Check delivered (should be ~426)
SELECT COUNT(*) as delivered_total
FROM orders 
WHERE platform = 'tiktok' 
  AND platform_status = 'DELIVERED';
```

### Step 3: Run Full Sync to Update fulfillment_status
The full sync will:
- Re-fetch all orders from TikTok API
- Update `fulfillment_status` for DELIVERED/COMPLETED/delivery_failed
- Verify counts against API

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Run full sync
node scripts/run-full-sync.js
```

**Monitor in Supabase:**
```sql
-- Watch sync progress (refresh every 30 seconds)
SELECT 
  account_id,
  sync_type,
  status,
  pages_fetched,
  orders_synced,
  next_page_token IS NOT NULL as has_more,
  updated_at
FROM platform_sync_progress
ORDER BY updated_at DESC;

-- Check sync logs for errors
SELECT action, status, message, created_at
FROM sync_logs
WHERE action = 'tiktok_sync_shop'
ORDER BY created_at DESC
LIMIT 10;
```

### Step 4: Verify Fulfillment Status Was Populated
```sql
-- Check fulfillment_status distribution
SELECT 
  fulfillment_status,
  COUNT(*) as count
FROM orders 
WHERE platform = 'tiktok'
GROUP BY fulfillment_status
ORDER BY count DESC;

-- Expected:
-- delivered: ~426
-- completed: ~5653 (from TikTok's COMPLETED)
-- NULL: remaining orders
```

### Step 5: Verify UI Counts Match API
After page reload:
1. Navigate to **订单管理中心** (Order Management)
2. Check TikTok Shop card counts
3. Verify:
   - "待发货" (To Ship) = 36 ✅ (was 29, now includes instant orders)
   - "运输中" (In Transit) = 60 ✅
   - "已送达" (Delivered) = 426 ✅

### Step 6: Check Fulfillment Status Badges
1. Click "已送达" (Delivered) filter
2. Orders should show fulfillment_status badges:
   - Status badge (出货, 接收, etc.)
   - **Fulfillment status badge** (delivered, completed) in slate gray
3. Verify all delivered orders have fulfillment_status populated

---

## Expected Counts After Sync

| Status | Platform | ERP Before | ERP After | Match? |
|--------|----------|-----------|-----------|--------|
| Awaiting Shipment | 36 | 29 | 36 | ✅ |
| In Transit | 60 | 68 | 60 | ✅ |
| Delivered | 426 | 426 | 426 | ✅ |
| Completed | 5653+ | - | >0 | ✅ |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Counts still don't match | Ensure sync completed (check sync_logs for 'COMPLETE' status) |
| No fulfillment_status badges | Run full sync again, or wait for next incremental sync |
| Instant orders still missing | Hard refresh browser (Cmd+Shift+R) to clear cache |
| Sync stuck/not starting | Check platform_accounts: status must be 'connected' with access_token |

---

## What Changed

**File:** `src/pagesOverviewOrders.jsx`  
**Lines:** 1150-1160

**Before:**
```javascript
excludeInstant(base().in("platform_status", ["AWAITING_SHIPMENT", "READY_TO_SHIP"])),
// Applied to both TikTok and Shopee
```

**After:**
```javascript
isShopee ? excludeInstant(base().in(...)) : base().in(...),
// Only applies excludeInstant to Shopee, TikTok includes all AWAITING_SHIPMENT
```

---

## Next Steps

1. ✅ Code fix deployed
2. ⏳ Run full sync (5-10 minutes)
3. ⏳ Verify counts in Supabase
4. ⏳ Reload ERP > check card counts
5. ⏳ Confirm fulfillment_status badges appear

**Timeline:** Counts should match within 15 minutes of completing full sync.
