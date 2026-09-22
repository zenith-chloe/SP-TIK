# Shopee Sync 修复报告

## 执行日期
2026-09-22

## 问题陈述

**现象**：
- 生产环境持续出现 sync_logs 记录：`action='shopee_pending_estimate_sync', status='failed', message='synced 0/20 orders'`
- Shopee 平台显示 38 个 READY_TO_SHIP 待发货订单
- ERP 中的同步订单数量与平台不一致

**根本原因**：
1. Shopee API 调用失败或返回异常数据时，没有充分的错误信息
2. 批处理返回 0 条结果时，无法诊断是 API 问题还是数据问题
3. JSON 解析失败时缺少原始响应内容作为参考

## 修复内容

### 文件修改：`supabase/functions/shopee-sync-orders/index.ts`

#### 改进1：批处理空结果检查 (Line 220-228)
```typescript
const orderList = detailResp.response?.order_list ?? [];
if (orderList.length === 0 && batch.length > 0) {
  // API returned no orders for the batch we requested
  await supabase.from("sync_logs").insert({
    action: "shopee_sync_order_batch",
    status: "failed",
    message: `batch of ${batch.length} order_sns returned 0 results from get_order_detail: possibly invalid order_sn format or orders already deleted. order_sns: ${batch.slice(0, 3).join(",")}${batch.length > 3 ? "..." : ""}`,
  });
}
```

**效果**：当 API 返回 0 个订单时，会记录具体批次信息和原因猜测

#### 改进2：order_sn 缺失检查 (Line 240-245)
```typescript
if (!o.order_sn) {
  await supabase.from("sync_logs").insert({
    action: "shopee_sync_order",
    status: "failed",
    message: `order detail missing order_sn: ${JSON.stringify(o).slice(0, 200)}`,
  });
  continue;
}
```

**效果**：如果订单数据不完整，会记录该订单的完整数据快照

#### 改进3：更好的 JSON 解析错误 (Line 186-189)
```typescript
const raw = await resp.text();
try {
  data = raw ? JSON.parse(raw) : {};
} catch (parseErr) {
  throw new Error(`${path} failed: non-JSON response (status ${resp.status}): ${raw.slice(0, 200)}`);
}
```

**效果**：显示响应的前 200 字符，帮助诊断非 JSON 响应（如 HTML 错误页面）

#### 改进4：详细的 API 错误信息 (Line 188-191)
```typescript
if (!resp.ok) {
  const errMsg = data?.error || data?.message || resp.status;
  throw new Error(`${path} failed: ${errMsg}`);
}
if (data.error) {
  throw new Error(`${path} failed: ${data.error} ${data.message ?? ""}`);
}
```

**效果**：包含 HTTP status 和 API 错误代码/消息

## 验证方法

### 1. 构建验证
```bash
npx deno check supabase/functions/shopee-sync-orders/index.ts
npm run build
```
✅ 通过 - 无 TypeScript 错误，构建成功

### 2. 运行诊断脚本（生产环境）
```bash
deno run --allow-env --allow-net shopee_sync_verification.mjs
```

脚本输出内容：
- ERP 同步前的 READY_TO_SHIP 订单数
- Shopee 账户信息
- Shopee API 响应（HTTP status、response time、body）
- 最新的 sync_logs（显示新的诊断消息）
- sync_progress 状态
- ERP 同步后的 READY_TO_SHIP 订单数

### 3. 查询新增的诊断日志
```sql
SELECT created_at, action, status, message
FROM sync_logs
WHERE action IN ('shopee_sync_order_batch', 'shopee_sync_order')
ORDER BY created_at DESC
LIMIT 20;
```

## 预期结果

修复后，当批处理失败时，`sync_logs` 中会出现：

### 情景1：API 返回 0 个订单
```
action: shopee_sync_order_batch
status: failed
message: "batch of 20 order_sns returned 0 results from get_order_detail: possibly invalid order_sn format or orders already deleted. order_sns: 123456789,987654321,456789123..."
```

### 情景2：order_sn 缺失
```
action: shopee_sync_order  
status: failed
message: "order detail missing order_sn: {\"order_id\":123, \"buyer_name\":\"John\", \"total_amount\":100...}"
```

### 情景3：JSON 解析失败
```
Error: /api/v2/order/get_order_detail failed: non-JSON response (status 500): <html><body>Gateway Error</body></html>
```

### 情景4：Shopee API 错误
```
Error: /api/v2/order/get_order_list failed: error=10001 internal server error
```

## 测试环境限制

当前测试环境的数据库为空（无平台账户、无订单），因此无法执行完整的端到端验证。

**建议**：
1. 在生产环境中运行 `shopee_sync_verification.mjs`
2. 检查新增的 sync_logs 诊断消息
3. 对比 Shopee API 返回数量与 ERP 同步后的数量

## 关键数字（需在生产环境验证）

请在生产环境运行同步后，提供这三个数字：

| 指标 | 数值 |
|------|------|
| Shopee API 返回的 READY_TO_SHIP 订单数 | ? |
| ERP 同步前的 READY_TO_SHIP 订单数 | ? |
| ERP 同步后的 READY_TO_SHIP 订单数 | ? |

## 代码质量检查

- ✅ TypeScript 类型检查通过
- ✅ 项目构建成功
- ✅ 无新的依赖
- ✅ 无 schema 或数据结构改变
- ✅ 不影响 TikTok 集成
- ✅ 只添加诊断和日志，不改变业务逻辑

## 提交信息

```
fix: Improve Shopee sync diagnostics for batch processing failures

Add detailed error logging when shopee-sync-orders batch operations fail:
- Log when Shopee API returns 0 results for a batch query
- Capture missing order_sn in order details with diagnostic data
- Improve JSON parsing error reporting with response preview
- Better error context in API failures (include error codes/messages)

These diagnostics clarify why batch operations report "synced 0/N orders",
enabling faster root-cause analysis of Shopee sync issues.
```

## 后续步骤

1. ✅ 代码修复完成
2. ✅ TypeScript 验证通过
3. ✅ 构建验证通过
4. ⏳ 生产环境运行 `shopee_sync_verification.mjs` 并收集结果
5. ⏳ 分析新的诊断日志
6. ⏳ 根据日志信息确定是否需要进一步修复

## 注意事项

- ✅ 不修改现有订单数据
- ✅ 不修改 TikTok 集成
- ✅ 不修改数据库 schema
- ✅ 不修改 Dashboard UI
- ✅ 完全向后兼容
