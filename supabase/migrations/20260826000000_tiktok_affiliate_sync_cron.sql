-- Schedules the new tiktok-sync-orders `action: "syncAffiliateCommissions"`
-- (2026-08-25/26) to run every 5 minutes — same header shape / secret as
-- the existing per-minute tiktok-sync-orders-incremental /
-- tiktok-settlement-sync-incremental jobs (see
-- 20260817020000_fix_tiktok_sync_cron_auth_header.sql for why the
-- Authorization header is required, not optional). 5 minutes instead of
-- every minute because affiliate order volume per shop is much smaller
-- than the full order stream (live-verified: 2172 rows synced across all
-- of KSG's existing orders in a single invocation, well under the 100s
-- time budget) — no need for per-minute cadence to stay caught up, and
-- this keeps TikTok API call volume down.
--
-- No platformAccountId in the body — the handler loops every row from
-- the existing `.eq("status","connected")` query, same shops the order
-- sync already covers, so a newly-connected shop picks this up
-- automatically with no cron change needed.
select cron.schedule(
  'tiktok-affiliate-sync-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://dtttdgdkhayzchmfptjt.supabase.co/functions/v1/tiktok-sync-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY',
      'x-sync-secret', '4f032ead5eaafcd8fdb9538d947b9acf6a952cfed11b9caaa73995f8aa4accfa'
    ),
    body := '{"action":"syncAffiliateCommissions"}'::jsonb
  );
  $$
);
