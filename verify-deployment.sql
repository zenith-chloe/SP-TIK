-- 验证部署完成的 SQL 查询
-- 在 Supabase SQL 编辑器中运行这些命令

-- 1. 验证 cron 任务已创建
SELECT * FROM cron.job WHERE jobname = 'cleanup-orders-60day';

-- 2. 验证 Edge Functions 已部署（查看 sync_logs）
SELECT
  action,
  status,
  message,
  created_at
FROM sync_logs
WHERE action LIKE 'cleanup%' OR action LIKE 'search%'
ORDER BY created_at DESC
LIMIT 10;

-- 3. 查看最近的 cron 执行记录
SELECT
  job_id,
  job_name,
  start_time,
  end_time,
  succeeded,
  return_message
FROM cron.job_run_details
WHERE job_name = 'cleanup-orders-60day'
ORDER BY start_time DESC
LIMIT 5;

-- 4. 验证表结构（确保没有意外修改）
SELECT COUNT(*) as total_orders FROM orders;
SELECT COUNT(*) as total_order_items FROM order_items;
SELECT COUNT(*) as total_platforms FROM platform_accounts WHERE hidden = false;
