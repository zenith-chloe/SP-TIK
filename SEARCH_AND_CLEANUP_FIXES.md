# TikTok/Shopee 订单搜索与 60 天自动清理修复

## 概述

本文档说明三个重要的订单管理改进：
1. **订单搜索 API 修复** - 允许搜索所有订单，不受加载限制
2. **60 天订单清理策略** - 自动删除已完成的老订单，保护未结算订单
3. **同步逻辑验证** - 确保同步所有订单状态（未完成+已完成）

---

## 问题和解决方案

### 1. 订单搜索问题

**原问题**：
- 前端 `loadRealData` 只加载最近 5000 个订单（按 `order_date` DESC）
- 订单 586077177301730791 等较老的订单无法搜索
- 搜索只在已加载的订单中进行，无法访问数据库全量数据

**解决方案**：
创建新的后端 Edge Function: `search-orders`
- 接受参数：`order_id` (订单号), `platform` (可选)
- 直接在数据库中搜索，无时间限制
- 返回完整订单信息 + 关联的 order_items

**使用方法**：
```bash
# 搜索特定订单（按订单号精确匹配）
curl "https://your-project.supabase.co/functions/v1/search-orders?order_id=586077177301730791"

# 按平台过滤
curl "https://your-project.supabase.co/functions/v1/search-orders?order_id=586077177301730791&platform=tiktok"
```

**返回格式**：
```json
{
  "success": true,
  "orders": [
    {
      "id": "uuid",
      "order_no": "586077177301730791",
      "platform": "tiktok",
      "platform_status": "IN_TRANSIT",
      "order_status": "shipped",
      "buyer_name": "...",
      "order_date": "2024-10-01T10:00:00.000Z",
      "created_at": "2024-10-01T10:30:00.000Z",
      "order_items": [
        {
          "sku": "SKU-123",
          "product_name": "...",
          "qty": 1,
          "...": "..."
        }
      ]
    }
  ],
  "count": 1,
  "message": "Found 1 order(s)"
}
```

---

### 2. 60 天订单清理策略

**问题**：
- 旧的 `cleanup-old-orders` 只删除 `order_status='completed'` 的订单
- 没有考虑订单是否真正已结算
- 可能误删未完成的订单

**解决方案**：
创建新的清理 Edge Function: `cleanup-orders-60day`

**清理规则**：
1. **清理条件（同时满足）**：
   - 订单创建于 60 天前（可配置）
   - 订单处于 **终态**（terminal state）

2. **终态定义**：
   - **TikTok**: `platform_status` in ['COMPLETED', 'CANCELLED', 'RETURNED', 'REFUNDED']
   - **Shopee**: `order_status='shipped'` + 已结算（settlement status）
   - **通用**: `order_status` in ['cancelled', 'returned']

3. **保护条件（永不删除）**：
   - 任何创建时间 < 60 天的订单
   - `platform_status` in ['UNPAID', 'ON_HOLD', 'AWAITING_SHIPMENT', 'AWAITING_COLLECTION', 'IN_TRANSIT', 'PARTIALLY_SHIPPING', 'PENDING', 'UNSETTLED', 'DISPUTE']
   - Shopee 未结算的订单

**清理流程**：
```
1. 扫描所有创建于 60 天前的订单
2. 检查是否处于终态
3. 如果是终态，删除该订单及关联的 order_items
4. 如果是未完成状态，跳过（保护）
5. 记录清理日志到 sync_logs
```

**定时任务**：
- 每日 2 AM UTC 自动执行（通过 pg_cron）
- 可通过 REST API 手动触发

**手动测试**：
```bash
# Dry run - 显示会删除什么，但不实际删除
curl -X POST "https://your-project.supabase.co/functions/v1/cleanup-orders-60day" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true, "retentionDays": 60}'

# 实际执行清理
curl -X POST "https://your-project.supabase.co/functions/v1/cleanup-orders-60day" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false, "retentionDays": 60}'
```

**响应格式**：
```json
{
  "success": true,
  "timestamp": "2024-10-03T02:00:00.000Z",
  "retentionDays": 60,
  "cutoffDate": "2024-08-04T02:00:00.000Z",
  "deletedOrders": 125,
  "deletedOrderItems": 342,
  "dryRun": false,
  "message": "Cleanup complete: deleted 125 terminal-state orders and 342 order_items (retention: 60 days). Protected 45 unfinished/unsettled orders."
}
```

---

### 3. 订单同步验证

**验证结果**：
✅ TikTok 同步函数 (`tiktok-sync-orders`):
- 不过滤 order_status
- 增量同步：按 `update_time_ge` 查询（捕获状态变化）
- 全量同步：无时间限制，按 `create_time` DESC 遍历
- **结论**：正确同步所有订单状态（待发货、运输中、已完成等）

✅ Shopee 同步函数 (`shopee-sync-orders`):
- 不过滤 order_status
- 同样捕获所有状态变化
- **结论**：正确同步所有订单状态

---

## 实施步骤

### 第 1 步：部署新 Edge Functions

```bash
# 部署搜索 API
supabase functions deploy search-orders

# 部署清理函数
supabase functions deploy cleanup-orders-60day
```

### 第 2 步：应用迁移（设置 cron 任务）

```bash
# 应用迁移来设置定时清理任务
supabase db push
```

### 第 3 步：验证

1. **测试搜索 API**：
   ```bash
   curl "https://your-project.supabase.co/functions/v1/search-orders?order_id=586077177301730791"
   ```
   应该返回完整的订单信息

2. **测试清理函数（Dry Run）**：
   ```bash
   curl -X POST "https://your-project.supabase.co/functions/v1/cleanup-orders-60day" \
     -H "Content-Type: application/json" \
     -d '{"dryRun": true, "retentionDays": 60}'
   ```
   验证会删除哪些订单

3. **验证 cron 任务**：
   ```sql
   -- 在 Supabase SQL 编辑器中运行
   SELECT * FROM cron.job WHERE jobname = 'cleanup-orders-60day';
   ```

---

## 配置选项

### 清理保留天数

修改 SQL 迁移中的 `retentionDays` 参数（默认 60 天）：
```sql
body := jsonb_build_object(
  'dryRun', false,
  'retentionDays', 60  -- 修改这里
)
```

### 定时任务时间

修改 SQL 迁移中的 cron 表达式（默认每日 2 AM UTC）：
```sql
SELECT cron.schedule(
  'cleanup-orders-60day',
  '0 2 * * *',  -- 修改为: '0 0 * * *' (0 AM), '0 6 * * 1' (周一 6 AM) 等
  ...
)
```

---

## 监控和日志

所有操作都记录到 `sync_logs` 表：

```sql
-- 查看最近清理的结果
SELECT * FROM sync_logs 
WHERE action = 'cleanup_old_orders_60day'
ORDER BY created_at DESC
LIMIT 10;

-- 查看清理失败的原因
SELECT * FROM sync_logs 
WHERE action = 'cleanup_old_orders_60day' AND status = 'failed'
ORDER BY created_at DESC;
```

---

## 安全保障

### 数据保护

1. **外键约束**：
   - `order_items.order_id` → `orders.id` (ON DELETE CASCADE)
   - 删除订单时自动删除关联的 order_items

2. **Dry Run 支持**：
   - 每次清理前可先用 `dryRun: true` 预览
   - 确认要删除的数据

3. **审计日志**：
   - 所有清理操作记录到 `sync_logs`
   - 可追踪删除了什么数据

### RLS 和权限

- 搜索 API：使用 `SUPABASE_SERVICE_ROLE_KEY`（后端权限）
- 清理函数：使用 `SUPABASE_SERVICE_ROLE_KEY`（后端权限）
- 对用户权限无影响

---

## 故障排除

### 搜索返回空结果
- 检查 `order_id` 是否正确（应为 platform order_no，如 "586077177301730791"）
- 确认订单确实存在于数据库（check `orders` table directly）
- 尝试去掉 `platform` 参数

### 清理函数错误
- 检查 `sync_logs` 表中的错误消息
- 运行 `dryRun: true` 版本查看详细信息
- 确保没有其他活跃的清理任务（检查 `platform_sync_progress`）

### Cron 任务没有运行
```sql
-- 检查 pg_cron 是否启用
SELECT * FROM pg_extension WHERE extname = 'pg_cron';

-- 检查任务状态
SELECT * FROM cron.job WHERE jobname = 'cleanup-orders-60day';

-- 查看最近一次执行结果
SELECT * FROM cron.job_run_details 
WHERE job_id = (SELECT jobid FROM cron.job WHERE jobname = 'cleanup-orders-60day')
ORDER BY start_time DESC LIMIT 5;
```

---

## 后续建议

1. **增强搜索**：
   - 支持模糊搜索 (like search)
   - 支持按平台/日期/状态组合过滤

2. **更精细的清理策略**：
   - 区分 TikTok settlement 状态
   - 支持按平台的不同保留期

3. **自动化报告**：
   - 每日清理报告发送到管理员邮箱
   - 监控清理趋势

---

## 关键字段说明

| 字段 | 说明 | 示例 |
|------|------|------|
| `order_no` | 平台订单号 | "586077177301730791" (TikTok) |
| `id` | 数据库内部 UUID | "550e8400-e29b-41d4-a716-446655440000" |
| `order_status` | ERP 规范化状态 | "pending", "shipped", "returned", "cancelled" |
| `platform_status` | 平台原始状态 | "AWAITING_SHIPMENT", "IN_TRANSIT", "COMPLETED" |
| `created_at` | 订单创建时间 | "2024-10-01T10:30:00.000Z" |
| `updated_at` | 最后更新时间 | "2024-10-03T14:20:00.000Z" |

