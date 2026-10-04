-- Schedule Shopee Return/Refund sync every 2 minutes — independent job,
-- independent function (shopee-sync-returns), does not touch or alter the
-- existing shopee-sync-orders-incremental job (jobid 9) in any way.
select cron.schedule(
  'shopee-sync-returns-incremental',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://dtttdgdkhayzchmfptjt.supabase.co/functions/v1/shopee-sync-returns',
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
