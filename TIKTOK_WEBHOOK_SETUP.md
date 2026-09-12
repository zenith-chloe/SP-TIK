# TikTok Shop Webhook Integration Guide

## Overview

This guide enables **real-time order status updates** from TikTok Shop via webhooks. Orders sync to your database within seconds of status changes, eliminating polling delays.

---

## 1. Edge Function Deployment

### Function Details
- **Name:** `tiktok-webhook`
- **Path:** `/supabase/functions/tiktok-webhook/index.ts`
- **Status:** ✅ Already deployed (v1)
- **URL:** `https://dtttdgdkhayzchmfptjt.supabase.co/functions/v1/tiktok-webhook`
- **Endpoint Type:** POST (receives TikTok webhooks)
- **Authentication:** TikTok signature verification (not JWT)

### What It Does
1. **Receives POST requests** from TikTok with order status changes
2. **Verifies TikTok signature** using `HMAC-SHA256(app_secret, timestamp + body)`
3. **Parses ORDER_STATUS_CHANGE events** and extracts order_id, order_status
4. **Updates local `orders` table** with new status (mapped to schema: pending/processing/shipped/cancelled)
5. **Returns 200 OK** to acknowledge webhook receipt to TikTok

---

## 2. TikTok Shop Configuration

### Step 1: Get Your Webhook URL
```
https://dtttdgdkhayzchmfptjt.supabase.co/functions/v1/tiktok-webhook
```

### Step 2: Log into TikTok Shop Partner Center
- Go: **https://seller.tiktokshop.com/partner/** (LIVE environment)
- Or: **https://seller-us.tiktokshop.com** (US region)

### Step 3: Register Webhook Endpoint
1. Navigate: **Settings → Apps → Your App → Webhooks** (or similar, exact path varies by region)
2. Click **Add Webhook** or **Register Webhook Endpoint**
3. Enter Webhook URL:
   ```
   https://dtttdgdkhayzchmfptjt.supabase.co/functions/v1/tiktok-webhook
   ```
4. Select Event Type: `ORDER_STATUS_CHANGE`
5. Choose Shops: Select the shop(s) to monitor
6. **Save / Confirm**

### Step 4: Verify Webhook (TikTok will test it)
- TikTok sends a **test webhook** to verify the endpoint is reachable
- Our function automatically verifies the signature
- If signature is valid, returns `{"code": "200", "message": "Received"}`
- TikTok confirms registration is successful

### Step 5: Monitor Webhook Delivery
1. In Partner Center, find **Webhook Logs** or **Event History**
2. Verify recent webhook deliveries show **"Success"** or **"Delivered"**
3. Check timestamps match your test orders

---

## 3. Required Environment Variables

Verify these are set in Supabase (Dashboard → Settings → Edge Functions → Secrets):

```
TIKTOK_APP_SECRET      = your_app_secret_from_partner_center
SUPABASE_URL           = https://dtttdgdkhayzchmfptjt.supabase.co
SUPABASE_SERVICE_ROLE_KEY = your_service_role_key
```

**Do NOT expose TIKTOK_APP_SECRET in frontend code.**

---

## 4. How Webhooks Work (Technical Flow)

### Order Status Change → TikTok Detection
```
Customer marks order as "Delivered" in TikTok Shop
                    ↓
TikTok detects status change
                    ↓
TikTok generates webhook event (ORDER_STATUS_CHANGE)
```

### Webhook Delivery to Your System
```
TikTok sends POST request with:
  - Header: x-tiktok-timestamp = 1789227407
  - Header: x-tiktok-sign = HMAC-SHA256(app_secret, timestamp + body)
  - Body: JSON with order_id, order_status, update_time, etc.
                    ↓
Your Supabase Edge Function (tiktok-webhook) receives it
                    ↓
Function verifies signature using TIKTOK_APP_SECRET
                    ↓
If valid: Parse order_id & order_status
          Map TikTok status to local schema
          UPDATE orders table WHERE order_id = ... AND platform = "tiktok"
                    ↓
Return 200 OK to TikTok (confirms receipt)
```

### Database Update
```
orders table:
  order_id = "12345678"
  platform = "tiktok"
  order_status: "pending" → "shipped" (mapped from TikTok's "DELIVERED")
  updated_at = now()

Result: Order auto-syncs in seconds, not minutes
```

---

## 5. Status Mapping (TikTok → Local Schema)

| TikTok Status | Local Status | Meaning |
|---|---|---|
| UNPAID | pending | Awaiting payment |
| AWAITING_SHIPMENT | pending | Not shipped yet |
| AWAITING_COLLECTION | processing | Ready for pickup/collection |
| PARTIALLY_SHIPPING | processing | Some items shipped |
| IN_TRANSIT | shipped | On the way |
| DELIVERED | shipped | Customer received |
| COMPLETED | shipped | Order complete |
| CANCELLED | cancelled | Order cancelled |

---

## 6. Testing the Webhook

### Manual Test (Using cURL)

```bash
#!/bin/bash
# Set these values
WEBHOOK_URL="https://dtttdgdkhayzchmfptjt.supabase.co/functions/v1/tiktok-webhook"
APP_SECRET="your_app_secret_from_tiktok_partner_center"
TIMESTAMP=$(date +%s)

# Create test webhook body
BODY='{
  "type": "ORDER_STATUS_CHANGE",
  "data": {
    "order_id": "123456789",
    "order_status": "COMPLETED",
    "update_time": 1789227407
  }
}'

# Calculate signature: HMAC-SHA256(app_secret, timestamp + body)
SIGN=$(echo -n "${TIMESTAMP}${BODY}" | openssl dgst -sha256 -hmac "${APP_SECRET}" | cut -d' ' -f2)

# Send webhook
curl -X POST "$WEBHOOK_URL" \
  -H "x-tiktok-timestamp: $TIMESTAMP" \
  -H "x-tiktok-sign: $SIGN" \
  -H "Content-Type: application/json" \
  -d "$BODY"

# Expected response: {"code":"200","message":"Received"}
```

### Check Webhook Logs
- **Supabase Dashboard** → **Functions** → **tiktok-webhook** → **Logs**
- Look for: `Processing order 123456789: COMPLETED -> shipped`
- Or error messages if signature validation fails

---

## 7. Troubleshooting

### Issue: Webhook Returns 403 (Signature Verification Failed)

**Cause:** Signature mismatch or wrong app secret

**Solution:**
1. Verify `TIKTOK_APP_SECRET` is correct in Supabase
2. Check timestamp isn't stale (TikTok uses server time)
3. Confirm body hasn't been modified in transit
4. Redeploy webhook: `supabase functions deploy tiktok-webhook`

### Issue: 404 Not Found

**Cause:** Webhook URL is incorrect or function not deployed

**Solution:**
1. Verify URL: `https://dtttdgdkhayzchmfptjt.supabase.co/functions/v1/tiktok-webhook`
2. Check function is active: `supabase functions list`
3. Deploy if missing: `supabase functions deploy tiktok-webhook`

### Issue: Order Not Updating in Database

**Cause:** Order doesn't exist, wrong platform, or permission issue

**Solution:**
1. Check order exists: `SELECT * FROM orders WHERE order_id = '123456789'`
2. Verify platform is `"tiktok"` (case-sensitive)
3. Check Supabase logs for error details
4. Ensure `SUPABASE_SERVICE_ROLE_KEY` is correct

### Issue: Webhook Not Triggering

**Cause:** Not registered in TikTok Partner Center or wrong event type

**Solution:**
1. Go to TikTok Partner Center → Webhooks
2. Confirm webhook is registered (not draft/pending)
3. Confirm event type is `ORDER_STATUS_CHANGE`
4. Check webhook is enabled (not disabled/paused)
5. Look at webhook delivery logs in Partner Center

---

## 8. Deployment & Local Development

### Deploy (if modified)
```bash
supabase functions deploy tiktok-webhook
```

### Local Testing
```bash
supabase functions serve tiktok-webhook
# Function runs on http://localhost:54321/functions/v1/tiktok-webhook
```

### View Logs
```bash
supabase functions list
supabase functions describe tiktok-webhook
```

---

## 9. Order Processing Flow

### Full Workflow Example

```
1. Customer places order on TikTok Shop
   → Our system polls get_order_list, finds new order → INSERT into orders table
   → order_status = "UNPAID"

2. Customer pays
   → TikTok webhook fires (ORDER_STATUS_CHANGE: UNPAID → AWAITING_SHIPMENT)
   → Our function receives it
   → UPDATE orders SET order_status = "pending" (mapped from AWAITING_SHIPMENT)
   → ERP sees updated status in real-time ✓

3. Shop packs and ships
   → TikTok webhook fires (ORDER_STATUS_CHANGE: AWAITING_SHIPMENT → IN_TRANSIT)
   → Our function updates order_status to "shipped" ✓

4. Customer receives
   → TikTok webhook fires (ORDER_STATUS_CHANGE: IN_TRANSIT → COMPLETED)
   → Our function updates order_status to "shipped" ✓

Result: Order status always in sync, no polling lag
```

---

## 10. Security Considerations

✅ **Implemented:**
- TikTok signature verification (HMAC-SHA256)
- App secret never exposed to frontend
- Service role key for database writes (restricted permissions)
- Webhook endpoint has `verify_jwt=false` (TikTok calls it directly)
- CORS headers configured for security

✅ **Best Practices:**
- Rotate app secret periodically (TikTok Partner Center)
- Monitor webhook logs for repeated failures
- Rate limiting (if many orders/sec, consider queue)
- Idempotent updates (safe to process same order twice)

---

## 11. Monitoring & Alerts

### Key Metrics
- **Webhook delivery latency:** seconds (check timestamps)
- **Success rate:** % of webhooks processed vs rejected
- **Database sync lag:** time between TikTok update and local DB update

### How to Monitor
1. **Supabase Dashboard** → Functions → Logs (real-time)
2. **TikTok Partner Center** → Webhooks → Delivery History
3. **PostgreSQL Logs:** `SELECT * FROM orders WHERE platform='tiktok' ORDER BY updated_at DESC LIMIT 10`

---

## Summary

| Component | URL / Value |
|---|---|
| Webhook Endpoint | `https://dtttdgdkhayzchmfptjt.supabase.co/functions/v1/tiktok-webhook` |
| Event Type | `ORDER_STATUS_CHANGE` |
| Required Secret | `TIKTOK_APP_SECRET` |
| Signature Method | `HMAC-SHA256(app_secret, timestamp + body)` |
| Response Code | `200` (success), `403` (invalid signature), `500` (server error) |
| Sync Speed | Seconds (vs. minutes with polling) |

✅ **Status:** Ready to configure in TikTok Partner Center
