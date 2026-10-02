-- Setup cleanup-orders-60day scheduled cron job
-- Deletes orders older than 60 days that are in terminal states only
-- Protects all unfinished/unsettled orders regardless of age
-- Runs daily at 2 AM UTC (0 2 * * * in cron format)

-- Check if the job already exists and remove it (safe operation)
SELECT cron.unschedule('cleanup-orders-60day') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup-orders-60day'
);

-- Schedule the new cleanup job
-- The edge function URL format: https://{project}.supabase.co/functions/v1/cleanup-orders-60day
SELECT cron.schedule(
  'cleanup-orders-60day',           -- job name
  '0 2 * * *',                      -- 2 AM UTC daily
  $$SELECT
    net.http_post(
      url := concat(
        'https://',
        current_setting('app.settings.supabase_url'),
        '/functions/v1/cleanup-orders-60day'
      ),
      headers := jsonb_build_object(
        'authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
        'content-type', 'application/json'
      ),
      body := jsonb_build_object(
        'dryRun', false,
        'retentionDays', 60
      ),
      timeout_milliseconds := 300000  -- 5 minute timeout
    ) as response;$$
);

-- Verify the job was created
SELECT * FROM cron.job WHERE jobname = 'cleanup-orders-60day';

-- Note: To test the cleanup locally without waiting for cron:
-- POST /functions/v1/cleanup-orders-60day with body: {"dryRun": true, "retentionDays": 60}
