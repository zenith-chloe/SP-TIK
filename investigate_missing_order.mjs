// 这个脚本需要从 Supabase 直接查询
// 由于我们没有环境变量，让我改用 SQL 查询的方式来说明

console.log(`
🔍 订单 586077177301730791 根本原因排查
========================================

根据代码分析：

1️⃣ 同步脚本验证结果:
   ✅ 增量同步（line 644）: { update_time_ge: sinceTs }
      - 查询参数：仅按 update_time 过滤，无 order_status 过滤
      - 结论：不会排除任何订单状态
   
   ✅ 全量同步（line 716）: {}
      - 查询参数：完全为空，应该获取所有订单
      - 结论：不会排除任何订单状态

   ✅ 补充扫描（line 755）: { update_time_ge: sinceTs }
      - 赔偿扫描也是按时间过滤，无状态过滤
      - 结论：应该捕获所有状态变化的订单

2️⃣ 需要查询的数据：
   请在 Supabase SQL Editor 中运行以下命令：
   
   -- 查询 1: 订单是否存在
   SELECT 
     id, order_no, platform, platform_status, order_status,
     created_at, updated_at
   FROM orders
   WHERE order_no = '586077177301730791';
   
   -- 查询 2: 同步日志中是否有该订单
   SELECT 
     action, status, message, created_at
   FROM sync_logs
   WHERE message ILIKE '%586077177301730791%'
   ORDER BY created_at DESC;
   
   -- 查询 3: 该订单在 order_items 中是否有项目
   SELECT COUNT(*) as item_count
   FROM order_items
   WHERE order_id = (SELECT id FROM orders WHERE order_no = '586077177301730791');
   
   -- 查询 4: TikTok 最近同步的时间范围
   SELECT 
     platform_account_id, 
     last_synced_at,
     created_at
   FROM platform_accounts
   WHERE platform = 'tiktok'
   LIMIT 5;
   
   -- 查询 5: 当时（2026-09-15）附近的同步日志
   SELECT 
     action, status, message, created_at
   FROM sync_logs
   WHERE action = 'tiktok_sync_shop'
   AND created_at >= '2026-09-10'::timestamp
   AND created_at <= '2026-09-20'::timestamp
   ORDER BY created_at DESC;

3️⃣ 可能的原因分析：
   
   根本原因假设（需要查询数据验证）：
   
   假设 A: 订单当时不存在于 TikTok API
   ├─ 症状：订单不在 orders 表中，同步日志无相关记录
   └─ 结论：TikTok API 在查询时间段内未返回该订单
   
   假设 B: 订单在 API 中但同步脚本跳过了
   ├─ 症状：orders 表无该订单，但同步日志有错误
   └─ 结论：API 返回了订单但 upsert 失败
   
   假设 C: 订单在同步范围外
   ├─ 症状：订单创建时间在当时的同步时间窗口外
   └─ 结论：last_synced_at 或 update_time 过滤导致遗漏
   
   假设 D: 订单在其他表（adjustments/settlements）
   ├─ 症状：orders 表无，但 order_items 有数据
   └─ 结论：搜索 API 只查了 orders，漏了其他表

✅ 下一步：请在 Supabase 中运行上述 SQL 查询，我会根据结果给出最终结论
`);
