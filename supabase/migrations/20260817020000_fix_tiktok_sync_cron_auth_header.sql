-- Fix: tiktok-sync-orders-incremental (jobid 8) has been silently 401'ing on
-- every single invocation since 2026-08-16 18:07 (confirmed live via
-- net._http_response: {"error":"unauthorized"} every minute since then).
-- Root cause: its net.http_post only sent 'apikey' + 'x-sync-secret'
-- headers, missing 'Authorization'. tiktok-sync-orders/index.ts's jwtRole()
-- reads the Authorization header only (not apikey) to determine the
-- caller's role — without it, role is undefined, which falls into the
-- `authorized = false` branch and rejects before syncOneShop ever runs, so
-- no orders/status updates land for ~14h even though the job "succeeded"
-- from pg_cron's point of view (it only confirms the async HTTP call was
-- dispatched, not that it got a 200).
--
-- Shopee's live cron job (jobid 9, shopee-sync-orders-incremental) already
-- sends all three headers correctly and has been syncing fine the whole
-- time — this migration brings TikTok's job in line with it, same anon key
-- reused for both apikey and Authorization: Bearer, same x-sync-secret.
-- cron.schedule() upserts by job name, so this replaces jobid 8's command
-- in place without creating a duplicate job.
--
-- Scope: cron job definition only. Does not touch tiktok-sync-orders/
-- index.ts, its status mapping, pagination/checkpoint logic, or any table
-- schema — the sync code itself was already correct, it just wasn't being
-- allowed to execute.
select cron.schedule(
  'tiktok-sync-orders-incremental',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://dtttdgdkhayzchmfptjt.supabase.co/functions/v1/tiktok-sync-orders',
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
