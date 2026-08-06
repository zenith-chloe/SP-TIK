-- Root cause of TikTok/ERP order drift found 2026-08-04: tiktok-sync-orders
-- had zero automatic trigger — every sync all session was a manual curl call.
-- pg_cron + pg_net are already enabled on this project (used by the existing
-- print_history cleanup job), so this reuses the same mechanism: a scheduled
-- HTTP POST to the incremental-sync endpoint. 5 minutes is a conservative
-- baseline restoring basic automation — NOT the 1-2s real-time polling that
-- was explicitly deferred pending further confirmation; pg_cron's minimum
-- granularity is 1 minute anyway, so sub-minute polling isn't possible here
-- regardless.
select cron.schedule(
  'tiktok-sync-orders-incremental',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://dtttdgdkhayzchmfptjt.supabase.co/functions/v1/tiktok-sync-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY'
    ),
    body := '{}'::jsonb
  );
  $$
);
