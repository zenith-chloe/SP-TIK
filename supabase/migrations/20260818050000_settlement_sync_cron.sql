-- Schedules shopee-settlement-sync / tiktok-settlement-sync to run every
-- minute, same cadence + header shape as the existing
-- shopee-sync-orders-incremental / tiktok-sync-orders-incremental jobs
-- (jobid 8/9) — including the Authorization header, learned the hard way
-- earlier this session (20260817020000_fix_tiktok_sync_cron_auth_header.sql)
-- that omitting it causes every invocation to silently 401 forever.
--
-- No body needed — both functions default to their batch-backfill mode
-- (up to BATCH_SIZE=20 real COMPLETED orders missing a settlement row,
-- oldest-completed-first) when called with an empty body, so this alone
-- gradually clears the historical backlog (~886 Shopee / ~5983 TikTok as of
-- 2026-08-18) over repeated invocations, then keeps up with newly-completed
-- orders going forward — same resumable-via-repetition pattern as the order
-- sync crons, not a single blocking pass.
select cron.schedule(
  'shopee-settlement-sync-incremental',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://dtttdgdkhayzchmfptjt.supabase.co/functions/v1/shopee-settlement-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY',
      'x-sync-secret', '4f032ead5eaafcd8fdb9538d947b9acf6a952cfed11b9caaa73995f8aa4accfa'
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'tiktok-settlement-sync-incremental',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://dtttdgdkhayzchmfptjt.supabase.co/functions/v1/tiktok-settlement-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY',
      'x-sync-secret', '4f032ead5eaafcd8fdb9538d947b9acf6a952cfed11b9caaa73995f8aa4accfa'
    ),
    body := '{}'::jsonb
  );
  $$
);
