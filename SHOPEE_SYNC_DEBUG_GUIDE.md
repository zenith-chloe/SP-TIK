# Shopee Sync Verification Guide

## 问题现象
- ERP 中的 Shopee READY_TO_SHIP 订单数量与 Shopee 平台不一致
- sync_logs 显示 "synced 0/20 orders" 的重复失败日志
- 没有详细的错误信息说明为什么批处理失败

## 已修复的内容

### 1. 改进的错误诊断 (shopee-sync-orders/index.ts)

修改点：
- ✅ 添加了对批处理空结果的检查 (line 220-228)
- ✅ 改进 JSON 解析错误报告 (line 186-189)
- ✅ 添加 order_sn 验证 (line 240-245)
- ✅ 更详细的 Shopee API 错误信息 (line 188-191)

### 2. 新增日志消息

现在以下情况会记录详细信息：

```
action: "shopee_sync_order_batch"
status: "failed"
message: "batch of 20 order_sns returned 0 results from get_order_detail: possibly invalid order_sn format or orders already deleted"
```

```
action: "shopee_sync_order"
status: "failed"  
message: "order detail missing order_sn: {...order data...}"
```

## 如何验证修复

### 方式1：运行诊断脚本（生产环境）

```bash
SUPABASE_URL="https://dtttdgdkhayzchmfptjt.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="your_key" \
deno run --allow-env --allow-net shopee_sync_verification.mjs
```

脚本会输出：
```
[STEP 1] Current ERP Status: X READY_TO_SHIP orders
[STEP 2] Shopee Account Info: shop_id, account_id, last_synced_at
[STEP 3] Invoking shopee-sync-orders: HTTP status, response time
[STEP 4] Waiting for sync to complete...
[STEP 5] Sync Logs: 最近的 10 条日志，显示详细错误
[STEP 6] Sync Progress: status, orders_synced, pages_fetched, last_error
[STEP 7] ERP Status AFTER sync: Y READY_TO_SHIP orders

VERIFICATION SUMMARY:
1. ERP BEFORE sync: X READY_TO_SHIP orders
2. ERP AFTER sync:  Y READY_TO_SHIP orders  
3. Change:          Y - X orders
```

### 方式2：直接查询 sync_logs

```sql
SELECT 
  created_at, 
  action, 
  status, 
  message
FROM sync_logs
WHERE action LIKE '%shopee%'
ORDER BY created_at DESC
LIMIT 20;
```

**新增的诊断日志会显示：**
- API 返回的实际错误代码
- JSON 解析失败的原因
- 批处理返回空结果的具体说明

### 方式3：检查 platform_sync_progress

```sql
SELECT 
  status,
  orders_synced,
  pages_fetched,
  sync_window_from,
  sync_window_to,
  last_error,
  updated_at
FROM platform_sync_progress
WHERE account_id = 'shopee_account_id'
ORDER BY updated_at DESC;
```

## 预期的修复效果

| 场景 | 原来 | 修复后 |
|------|------|--------|
| API 返回 0 条订单 | 默默失败，无日志 | 记录："batch of 20 order_sns returned 0 results" + 原因分析 |
| JSON 解析失败 | 模糊的错误信息 | 显示 HTTP status + 原始响应预览 |
| order_sn 缺失 | 继续处理，可能创建坏数据 | 跳过该订单，记录完整的订单数据快照 |
| Shopee API 错误 | 简单错误消息 | 包含 error_code, message, HTTP status |

## 如果仍然有问题

### 情景1：synced 0/20 仍在出现

查询最新的 sync_logs，会发现：
- "API returned 0 results" → 检查 order_sn 格式是否有误
- "Non-JSON response" → Shopee API 故障或网络问题  
- "order detail missing order_sn" → 数据完整性问题

### 情景2：仍然没有订单被同步

检查 shopee-sync-orders 的查询条件：
- 时间窗口是否太窄 (默认 15 天)
- platform_status 过滤是否生效
- Shopee 账户是否正确关联

### 情景3：某些订单无法更新

检查是否触发了唯一性约束 (UNIQUE(platform, order_no))
- 同一订单不会被重复创建
- 但会被 upsert 更新

## 关键数字

运行同步后，记录这三个数字：

```
Shopee API 返回的 READY_TO_SHIP 订单数: ___
ERP 同步前的 READY_TO_SHIP 订单数:    ___
ERP 同步后的 READY_TO_SHIP 订单数:    ___
```

差异分析：
- 如果同步后数字增加，说明同步成功
- 如果没变化，查看 sync_logs 了解失败原因
- 如果数字减少，检查是否有订单状态改变
