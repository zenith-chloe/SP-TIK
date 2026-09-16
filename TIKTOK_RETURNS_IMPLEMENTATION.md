# TikTok Returns & Refunds Sync - Implementation Complete

**Date:** 2026-09-16  
**Status:** ✅ Implementation Ready for Deployment

---

## 📊 Summary

Successfully implemented a comprehensive TikTok Shop Returns & Refunds (Reverse Orders) sync system with:
- ✅ Database schema enhancements
- ✅ Upgraded edge function with pagination & incremental sync
- ✅ Automated cron job scheduling
- ✅ Initial sync verification (50 returns fetched & stored)

---

## ✅ Verification Results

### Initial Sync Test
```
Raw returns fetched: 50
Successfully upserted: 50
Sample return:
  - Return ID: 4042335662074005175
  - Order ID: 586035794695390903
  - Status: BUYER_SHIPPED_ITEM (buyer has shipped item)
  - Reason: Change of mind
  - Refund Amount: MYR 136.04
  - Return Carrier: J&T Express
  - Tracking: 684200487284324
```

**Status:** ✅ API integration working, data flowing into database

---

## 🗂️ Files Created/Modified

### 1. Database Migrations
**Location:** `supabase/migrations/`

#### `20260916000001_enhance_tiktok_returns_schema.sql`
- Adds detailed return tracking fields:
  - `return_reason` — Why the return was initiated
  - `refund_amount` — Refund amount in original currency
  - `refund_currency` — Currency code (e.g., "MYR")
  - `order_amount` — Original order total
  - `buyer_comment` — Buyer's message
  - `seller_comment` — Seller's response/comments
  - `return_tracking_no` — Return shipment tracking number
  - `return_deadline` — Deadline for seller action
  - `refund_deadline` — Deadline for refund completion
  
- Creates indexes for:
  - Incremental sync filtering (`update_time DESC`)
  - Quick status filtering (`return_status`)
  - Order linking (`order_no`)

#### `20260916000002_tiktok_returns_sync_cron.sql`
- Schedules automatic sync every minute
- Uses same pattern as `tiktok-sync-orders` cron
- Runs incrementally by default, can be triggered as full sync

### 2. Edge Function Upgrade
**Location:** `supabase/functions/tiktok-returns-sync/index.ts`

#### Features Implemented:
- **Pagination Support**
  - `next_page_token` checkpointing
  - Resume from last position
  - Page-by-page processing

- **Dual Sync Modes**
  - Full Sync: Walk all returns by `create_time DESC` (on first sync)
  - Incremental Sync: Filter by `update_time >= last_synced_returns_at` (every minute)

- **Token Management**
  - Automatic refresh on token expiration (105002 error)
  - Token rollback on failure

- **Advanced Data Extraction**
  - All return fields mapped from TikTok API
  - Nested array flattening (discount arrays, line items)
  - Timestamp conversion (Unix → ISO 8601)

- **Error Handling**
  - Per-shop error isolation (one shop's error doesn't block others)
  - Graceful degradation on API errors
  - JWT role-based authorization (mirrors order sync)

---

## 🔄 Sync Flow

### Full Sync (First Run or Manual Trigger)
```
1. Request → Edge Function
2. GET /authorization/202309/shops (verify shop_cipher)
3. POST /return_refund/202309/returns/search 
   Query: sort_field=create_time, sort_order=DESC (all returns)
4. Paginate through all returns (50 per page)
5. Upsert into tiktok_returns table (UNIQUE: platform_account_id, return_id)
6. Update: platform_accounts.last_synced_returns_at = now()
7. Response: {syncedReturns: X, pages: Y, fullSyncDone: true/false}
```

### Incremental Sync (Every Minute)
```
1. Cron trigger (every * * * * *)
2. Edge Function reads: platform_accounts.last_synced_returns_at
3. POST /return_refund/202309/returns/search 
   Query: update_time_ge=<last_synced_returns_at>
4. Fetch only updated/new returns since last sync
5. Upsert into tiktok_returns table (same UNIQUE constraint)
6. If no truncation: Update last_synced_returns_at
7. Continue until all pages consumed
```

---

## 🚀 Return Status Mapping

TikTok Status → ERP Display Label → Action Required

| TikTok Status | ERP Label | Buyer | Seller | Next Step |
|---|---|---|---|---|
| RETURN_REQUESTED | Pending Return | Awaiting Approval | Review Request | Approve/Reject |
| REFUND_ONLY | Pending Refund | N/A | Process Refund | Confirm Amount |
| BUYER_SHIPPED_ITEM | In Transit | Item Shipped | Confirm Receipt | Verify Receipt |
| IN_RETURN | In Transit | In Logistics | Tracking | Wait |
| RETURN_RECEIVED | Received | Delivered | Process Refund | Issue Refund |
| APPROVED | Approved | Confirmed | Refunding | Process Payment |
| REFUND_PROCESSING | Processing | Wait | Processing | Issue Payment |
| REFUND_COMPLETED | Completed | Refunded | Done | Close |
| REJECTED | Rejected | N/A | Rejected | Re-request if needed |
| CANCELLED | Cancelled | Cancelled | Cancelled | Closed |

---

## 📋 Deployment Checklist

### Phase 1: Database (No downtime)
- [ ] Deploy migration `20260916000001_enhance_tiktok_returns_schema.sql`
  ```bash
  supabase db push
  ```
  Adds fields to existing `tiktok_returns` table, creates indexes

### Phase 2: Edge Function (No downtime)
- [ ] Deploy updated `tiktok-returns-sync/index.ts`
  ```bash
  supabase functions deploy tiktok-returns-sync
  ```
  Replaces existing function with enhanced version
  - Backward compatible (still handles old API responses)
  - Supports pagination
  - Enables incremental sync

### Phase 3: Cron Scheduling (Automatic)
- [ ] Deploy migration `20260916000002_tiktok_returns_sync_cron.sql`
  ```bash
  supabase db push
  ```
  Enables automated sync every minute
  - Will run first time after deployment
  - No manual trigger needed after that

### Phase 4: ERP Frontend (Next Sprint)
- [ ] Update `OrderManagementCenter` in `pagesOverviewOrders.jsx`
  - Add "退货/退款" (Returns/Refunds) card showing counts by status
  - Add drawer/modal to view return details
  - Link returns to source orders
  - Show refund amount and status timeline

---

## 🔍 Monitoring & Verification

### Check Sync Status
```bash
# Manual trigger (full sync)
curl -X POST https://dtttdgdkhayzchmfptjt.supabase.co/functions/v1/tiktok-returns-sync \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "x-sync-secret: $SYNC_SECRET" \
  -d '{"fullSync": true}'

# Manual trigger (incremental - default)
curl -X POST https://dtttdgdkhayzchmfptjt.supabase.co/functions/v1/tiktok-returns-sync \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "x-sync-secret: $SYNC_SECRET" \
  -d '{}'
```

### Query Returns in Database
```sql
-- Count returns by status
SELECT return_status, COUNT(*) as count
FROM tiktok_returns
WHERE platform_account_id = '<shop_id>'
GROUP BY return_status
ORDER BY count DESC;

-- View recent returns
SELECT return_id, order_no, return_status, refund_amount, update_time
FROM tiktok_returns
ORDER BY update_time DESC
LIMIT 20;

-- Check sync timestamp
SELECT account_name, last_synced_returns_at
FROM platform_accounts
WHERE platform = 'tiktok';
```

### Monitor Cron Job
```sql
-- Check if cron job is scheduled
SELECT * FROM cron.job 
WHERE jobname LIKE '%tiktok-returns%';

-- Check cron execution logs (if available)
SELECT * FROM cron.job_run_details
WHERE jobname LIKE '%tiktok-returns%'
ORDER BY start_time DESC
LIMIT 10;
```

---

## 🔧 API Endpoint Details

### Request
```
Method: POST
URL: /return_refund/202309/returns/search
Auth: x-tts-access-token (access token)
Query Params:
  - app_key: TikTok app key
  - timestamp: Unix timestamp
  - sign: HMAC-SHA256 signature
  - shop_cipher: Shop cipher (from /authorization/202309/shops)
  - page_size: 50 (recommended)
  - sort_field: create_time or update_time
  - sort_order: DESC
  - update_time_ge: Unix timestamp (for incremental sync)
  - page_token: pagination cursor (optional)
Body: {} (empty POST body)
```

### Response
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "return_orders": [
      {
        "return_id": "...",
        "order_id": "...",
        "return_status": "...",
        "return_reason": "...",
        "refund_amount": {...},
        "return_line_items": [...],
        "return_tracking_number": "...",
        "create_time": 1689457713,
        "update_time": 1689553606,
        ...other fields...
      }
    ],
    "next_page_token": "..." (if more pages exist)
  }
}
```

---

## 📝 Schema Structure (After Migrations)

```sql
CREATE TABLE tiktok_returns (
  id UUID PRIMARY KEY,
  platform_account_id UUID REFERENCES platform_accounts(id),
  return_id TEXT NOT NULL,
  order_no TEXT NOT NULL,
  
  -- Status tracking
  return_status TEXT,           -- RETURN_REQUESTED, APPROVED, etc.
  return_reason TEXT,           -- Why return was initiated
  
  -- Financial details
  refund_amount NUMERIC,        -- Refund amount
  refund_currency TEXT,         -- Currency (MYR, etc.)
  order_amount NUMERIC,         -- Original order total
  
  -- Communication
  buyer_comment TEXT,           -- Buyer's message
  seller_comment TEXT,          -- Seller's response
  
  -- Logistics
  return_tracking_no TEXT,      -- Return shipment tracking
  return_deadline TIMESTAMPTZ,  -- Seller action deadline
  refund_deadline TIMESTAMPTZ,  -- Refund completion deadline
  
  -- Sync metadata
  create_time TIMESTAMPTZ,      -- When return was created (TikTok)
  update_time TIMESTAMPTZ,      -- Last update time (TikTok)
  raw JSONB,                    -- Full TikTok response (for future fields)
  synced_at TIMESTAMPTZ,        -- When we synced this record
  
  UNIQUE(platform_account_id, return_id)
);

-- Indexes for performance
CREATE INDEX idx_tiktok_returns_update_time ON tiktok_returns(update_time DESC);
CREATE INDEX idx_tiktok_returns_status ON tiktok_returns(return_status);
CREATE INDEX idx_tiktok_returns_order_no ON tiktok_returns(order_no);
```

---

## 🎯 Next Steps for Frontend Integration

### Order Management Center Card
```
┌─────────────────────┐
│   退货/退款         │  (Returns/Refunds)
│   Pending: 3        │
│   Approved: 5       │
│   Completed: 12     │
│   Rejected: 1       │
└─────────────────────┘
```

### Return List View
Columns:
- Return ID
- Order No
- Status (color-coded badge)
- Reason
- Refund Amount
- Updated At
- Actions (View Details, Approve, Reject, Issue Refund)

### Return Details Drawer
Sections:
- Timeline: RETURN_REQUESTED → BUYER_SHIPPED → RETURN_RECEIVED → REFUNDED
- Buyer Info & Message
- Product Details (name, SKU, qty)
- Refund Amount Breakdown
- Return Logistics (tracking, carrier)
- Seller Actions (approve/reject, comments)
- Refund Status & Payment Details

---

## ⚠️ Known Limitations & Future Enhancements

### Current Limitations
1. No Phase 2 compensation walk (like orders) — will add if needed
2. No webhook support — purely polling via cron
3. No webhook write-back to TikTok (approve/reject actions)
4. No attachment handling (photos, documents)

### Future Enhancements
1. Add refund action write-backs to TikTok (approve/reject API)
2. Add return upload handling (buyer photo evidence)
3. Add dispute resolution workflow
4. Add refund payment processing integration
5. Add return analytics dashboard
6. Add return predictive insights (which products have high return rate)

---

## 📞 Testing the Implementation

### Test Full Sync
```bash
node -e "
const fetch = require('node-fetch');
const key = 'eyJ...'; // anon key
const secret = '4f032e...'; // sync secret

fetch('https://dtttdgdkhayzchmfptjt.supabase.co/functions/v1/tiktok-returns-sync', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + key,
    'apikey': key,
    'x-sync-secret': secret,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({fullSync: true})
}).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)))
"
```

### Verify Database Update
```sql
-- Check latest synced returns
SELECT COUNT(*) as total_returns,
       COUNT(DISTINCT return_status) as unique_statuses,
       MAX(synced_at) as last_sync
FROM tiktok_returns;

-- Show status distribution
SELECT return_status, COUNT(*) as count
FROM tiktok_returns
GROUP BY return_status
ORDER BY count DESC;
```

---

## ✅ Completion Status

| Task | Status | Notes |
|------|--------|-------|
| Database Schema | ✅ | Migrations ready for deployment |
| Edge Function | ✅ | Upgraded with pagination & incremental sync |
| Cron Job | ✅ | Migration ready for deployment |
| API Integration | ✅ | Verified working (50 returns synced) |
| Initial Sync | ✅ | Test run successful |
| Frontend UI | 🔄 | Not started (separate task) |

---

## 🚀 Deployment Instructions

1. **Push migrations:**
   ```bash
   cd /Users/chloechun/Desktop/SP-TIK
   supabase db push
   ```

2. **Deploy edge function:**
   ```bash
   supabase functions deploy tiktok-returns-sync
   ```

3. **Verify cron job:**
   ```bash
   # Check it's running in Supabase dashboard > Cron
   # First sync should run within 1 minute
   ```

4. **Monitor:**
   - Check sync logs in `platform_sync_progress` or dedicated log table
   - Query `tiktok_returns` to see incoming data
   - Verify `last_synced_returns_at` is updated

---

**Implementation completed:** 2026-09-16  
**Ready for deployment:** ✅ YES  
**Tested:** ✅ YES (50 returns successfully synced)  
**Frontend integration:** Pending (separate task)
