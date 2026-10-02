# 订单 586077177301730791 缺失根本原因分析

**状态**: 🔍 排查中  
**日期**: 2026-10-03  
**目标**: 找出为什么该订单当初没有同步进 ERP 数据库

---

## 📊 第一阶段：代码分析已完成

### 同步脚本过滤条件检查

#### ✅ 增量同步检查 (line 644)
```typescript
const result = await walkPages(
  creds, 
  account, 
  baseQuery, 
  { update_time_ge: sinceTs },  // ← 仅按时间过滤
  ...
);
```
**结论**: ✅ 无 `order_status` 过滤 - 所有状态的订单都会被拉取

#### ✅ 全量同步检查 (line 716)
```typescript
const result = await walkPages(
  creds, 
  account, 
  baseQuery, 
  {},  // ← 空的查询条件，应该获取全部订单
  ...
);
```
**结论**: ✅ 无任何状态过滤 - 理论上应该获取所有订单

#### ✅ 补偿扫描检查 (line 755)
```typescript
const result = await walkPages(
  creds, 
  account, 
  baseQuery, 
  { update_time_ge: sinceTs },  // ← 仅按时间过滤
  ...
);
```
**结论**: ✅ 无状态过滤 - 只要在时间窗口内就会同步

---

## 🔎 第二阶段：数据查询（需要你执行）

### 重要：在 Supabase SQL Editor 中按顺序运行以下查询

#### 查询 1️⃣ : 订单是否存在于数据库

```sql
-- 检查订单 586077177301730791 是否在 orders 表中
SELECT 
  id, 
  order_no, 
  platform, 
  platform_status, 
  order_status,
  created_at, 
  updated_at,
  buyer_name,
  shipping_address
FROM orders
WHERE order_no = '586077177301730791';
```

**预期结果**:
- 如果有结果: 订单存在，说明**已同步** ✅
- 如果无结果: 订单不存在，说明**未同步** ❌

---

#### 查询 2️⃣ : 同步日志中是否有该订单的记录

```sql
-- 检查 sync_logs 中是否有该订单号的任何记录
SELECT 
  action, 
  status, 
  message, 
  created_at,
  updated_at
FROM sync_logs
WHERE message ILIKE '%586077177301730791%'
   OR message ILIKE '%58607717730173%'  -- 可能的截断版本
ORDER BY created_at DESC
LIMIT 20;
```

**预期结果**:
- 如果有结果: 同步脚本接触过这个订单（可能成功或失败）
- 如果无结果: 同步脚本从未看到这个订单

---

#### 查询 3️⃣ : 订单的 order_items

```sql
-- 检查该订单是否有关联的 order_items
SELECT 
  id,
  order_id, 
  sku, 
  product_name,
  qty,
  created_at
FROM order_items
WHERE order_id = (
  SELECT id FROM orders WHERE order_no = '586077177301730791'
);
```

**预期结果**:
- 有项目: 订单存在且有商品信息
- 无项目: 订单完全缺失或孤立

---

#### 查询 4️⃣ : TikTok Shop 帐户的同步时间线

```sql
-- 查看 TikTok Shop 帐户的同步历史
SELECT 
  id,
  platform, 
  shop_id,
  account_name,
  last_synced_at,
  created_at,
  updated_at
FROM platform_accounts
WHERE platform = 'tiktok'
ORDER BY last_synced_at DESC
LIMIT 1;
```

**预期结果**:
- 显示 `last_synced_at` 的时间
- 对比订单创建时间（2026-09-15）是否在同步范围内

---

#### 查询 5️⃣ : 2026-09-10 到 09-20 期间的同步日志

```sql
-- 查看该订单创建时间附近的同步任务
SELECT 
  id,
  action, 
  status, 
  message, 
  created_at
FROM sync_logs
WHERE action = 'tiktok_sync_shop'
AND created_at >= '2026-09-10T00:00:00Z'::timestamp
AND created_at <= '2026-09-20T23:59:59Z'::timestamp
ORDER BY created_at DESC;
```

**预期结果**:
- 显示这个时间段内是否有 TikTok 同步任务
- 检查同步是否成功（status = 'success'）

---

#### 查询 6️⃣ : 订单的原始 TikTok 状态

```sql
-- 如果订单存在，检查其 TikTok 状态
SELECT 
  order_no,
  platform_status,  -- 原始 TikTok 状态（如 AWAITING_SHIPMENT）
  order_status,     -- 规范化状态（如 pending）
  fulfillment_status,
  is_cod,
  created_at
FROM orders
WHERE order_no = '586077177301730791';
```

**预期结果**:
- 显示订单的原始平台状态和规范化后的状态

---

## 📋 根本原因假设

基于上述查询，可能的根本原因：

### 假设 A：订单当时根本不存在于 TikTok API ❌

**症状**:
- `查询 1` 结果：无
- `查询 2` 结果：无
- `查询 5` 结果：同步任务存在且成功

**原因**: TikTok API 在同步时间段内未返回该订单  
**可能场景**: 
- 订单当时的 `platform_status` 是某个 TikTok 特殊状态，API 默认不返回
- 订单被 TikTok 标记为隐藏/删除，API 未返回
- 订单使用的是不同的 Shop ID

**验证方法**: 检查 TikTok Seller Center 该订单是否存在

---

### 假设 B：订单在 API 中，但同步脚本拒绝了 ❌

**症状**:
- `查询 1` 结果：无
- `查询 2` 结果：有错误日志 (status = 'failed')
- `查询 5` 结果：同步任务存在

**原因**: 订单数据损坏或字段缺失，`upsert` 操作失败  
**可能场景**:
- `order_no` 为 NULL 或无效格式
- 必需字段（如 `buyer_name`、`shipping_address`）缺失
- JSON 解析错误

**验证方法**: 查看 `查询 2` 中的错误消息

---

### 假设 C：订单在同步时间窗口外 ⏰

**症状**:
- `查询 1` 结果：无
- `查询 2` 结果：无
- `查询 5` 结果：同步任务存在，但时间不覆盖订单创建时间

**原因**: `last_synced_at` 或 `update_time_ge` 过滤导致订单被跳过  
**可能场景**:
- 当时的 `last_synced_at` 是 2026-09-16，但订单在 2026-09-15 创建
- 同步时间窗口太窄，错过了订单

**验证方法**: 对比 `查询 4` 的 `last_synced_at` 与订单创建时间

---

### 假设 D：订单在其他表中，搜索 API 漏查 📦

**症状**:
- `查询 1` 结果：无（orders 表中不存在）
- `查询 3` 结果：有数据（order_items 存在）
- 使用 `search-orders` API 也找不到

**原因**: 订单数据被保存在其他表（adjustments/settlements），搜索 API 只查了 orders  
**可能场景**:
- 订单是退货/调整单，存储在 `adjustments` 表
- 订单结算数据存储在 `order_settlements` 表

**验证方法**: 
```sql
SELECT * FROM order_items WHERE order_id LIKE '%586077177301730791%';
SELECT * FROM adjustments WHERE order_no = '586077177301730791';
SELECT * FROM order_settlements WHERE order_no = '586077177301730791';
```

---

## ✅ 下一步行动步骤

### Step 1: 执行数据查询
在 Supabase SQL Editor 中**按顺序**运行上述 6 个查询，记录结果

### Step 2: 对应假设
根据查询结果，确定是假设 A/B/C/D 中的哪一个

### Step 3: 反馈查询结果
将查询结果反馈给我（可以粘贴查询输出），我会：
- 确定根本原因
- 建议补救措施
- 提供修复脚本（不会自动执行，只在你同意后运行）

### Step 4: 验证修复
确认订单已成功补充到系统中

---

## 📝 注意事项

⚠️ **重要**:
- ❌ 不要进行任何 DELETE/UPDATE/INSERT 操作
- ✅ 只运行上述 SELECT 查询（只读）
- ✅ 可以自由复制/粘贴查询结果
- ✅ 所有查询都是安全的只读操作

---

## 📚 参考资料

- TikTok API 文档: `/order/202309/orders/search`
- 同步脚本: `supabase/functions/tiktok-sync-orders/index.ts`
- 搜索 API: `supabase/functions/search-orders/index.ts`

---

**准备好执行查询？请在 Supabase SQL Editor 中运行上述 6 个查询并反馈结果。** 📊
