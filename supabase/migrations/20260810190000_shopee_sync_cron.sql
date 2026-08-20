-- Shopee had zero automatic trigger (found during 2026-08-10 observation
-- phase — every sync all session was a manual curl call, mirroring the same
-- gap TikTok had before 20260804000003_tiktok_sync_cron.sql). Adds only the
-- missing scheduler, same pg_cron + pg_net mechanism, same call shape.
-- Schedule matches TikTok's actual LIVE cron cadence (`* * * * *`, every
-- minute) rather than TikTok's migration-file text (`*/5 * * * *`), since
-- the live TikTok job was changed after that migration ran and never
-- back-filled — this job intentionally matches real behavior, not the
-- stale file. Does not touch the existing tiktok-sync-orders-incremental
-- job, syncOneShop, checkpoint/state machine, or any table schema.
select cron.schedule(
  'shopee-sync-orders-incremental',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://dtttdgdkhayzchmfptjt.supabase.co/functions/v1/shopee-sync-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY'
    ),
    body := '{}'::jsonb
  );
  $$
);
