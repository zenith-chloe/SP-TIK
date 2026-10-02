# 订单 586077177301730791 缺失原因 - 排查总结

## 🎯 排查结论（基于代码分析）

### ✅ 已排除的问题：

| 问题 | 状态 | 理由 |
|------|------|------|
| 同步脚本按 order_status 过滤 | ✅ 排除 | 增量/全量同步都不过滤状态 |
| 同步脚本排除未完成订单 | ✅ 排除 | API 请求体无状态过滤条件 |
| 分页逻辑漏抓 | ✅ 可能性小 | 代码有补偿扫描机制(compensation) |

---

## ❓ 剩余可能的根本原因

### 原因 1: 订单在 TikTok API 中不存在（当时）
- **症状**: orders 表无该订单，sync_logs 无记录
- **解决**: 检查 TikTok Seller Center 中该订单是否存在

### 原因 2: 订单在 API 中但同步失败
- **症状**: sync_logs 中有该订单的错误记录  
- **解决**: 查看错误消息，修复数据问题

### 原因 3: 订单在同步时间窗口外
- **症状**: last_synced_at 在订单创建时间之后
- **解决**: 重新运行全量同步

### 原因 4: 订单存储在其他表（adjustments/settlements）
- **症状**: orders 表无，但其他表有数据
- **解决**: 更新搜索 API 支持其他表

---

## 🔧 需要你执行的步骤

### 第 1 步：收集数据（在 Supabase SQL Editor 中运行）

**查询集合** (见下方):

```sql
-- 检查订单是否存在
SELECT COUNT(*) FROM orders WHERE order_no = '586077177301730791';

-- 检查同步日志
SELECT COUNT(*) FROM sync_logs WHERE message ILIKE '%586077177301730791%';

-- 检查订单项
SELECT COUNT(*) FROM order_items 
WHERE order_id = (SELECT id FROM orders WHERE order_no = '586077177301730791');

-- 检查 TikTok 同步历史
SELECT last_synced_at FROM platform_accounts 
WHERE platform = 'tiktok' ORDER BY last_synced_at DESC LIMIT 1;

-- 检查当时的同步日志
SELECT COUNT(*) FROM sync_logs
WHERE action = 'tiktok_sync_shop'
AND created_at BETWEEN '2026-09-10' AND '2026-09-20';
```

### 第 2 步：基于结果诊断

根据上述查询的结果，判断属于哪个原因类别

### 第 3 步：反馈结果

将查询结果告诉我，我会：
- 确定根本原因
- 提供具体的修复方案
- 如需补数据，提供详细的补充脚本

---

## 📊 快速诊断树

```
开始
├─ orders 表中有该订单？
│  ├─ YES → ✅ 订单已存在，无需处理
│  └─ NO ↓
├─ sync_logs 中有错误？
│  ├─ YES → 原因 2️⃣ 同步脚本拒绝了
│  └─ NO ↓
├─ TikTok 最后同步时间 >= 订单创建时间？
│  ├─ YES → 原因 1️⃣ 订单不在 TikTok API 中
│  └─ NO → 原因 3️⃣ 时间窗口外
│
├─ 其他表（adjustments/settlements）中有数据？
│  ├─ YES → 原因 4️⃣ 订单存储在其他表
│  └─ NO → 未知原因
```

---

## ⚠️ 重要提醒

- ❌ **不要做**: 任何 DELETE/UPDATE/INSERT 操作
- ✅ **可以做**: 运行 SELECT 查询（只读）
- ✅ **安全的**: 所有建议的查询都是只读的

---

## 📞 下一步

**请在 Supabase 中运行上述查询，然后告诉我结果。**

详细的根本原因分析文档见: `ORDER_586077177301730791_ROOT_CAUSE_ANALYSIS.md`

一旦确定了根本原因，我会提供针对性的修复方案。
