# 手动清理指南 - Supabase Dashboard 方式

## 📋 概述

由于网络限制（无法从外部访问 Supabase API），我们采用在 **Supabase Dashboard 中手动运行清理函数** 的方式。

✅ **优势：**
- 简单直观，无需终端命令
- 立即生效，无需 VPN
- 完全可控，可以随时监控执行结果
- 安全可靠，在官方 Dashboard 中运行

---

## 🚀 快速开始（每次只需 3 步）

### **第 1 步：打开 Supabase Dashboard**
1. 访问 https://supabase.com/dashboard
2. 选择你的项目 **motoparts-oms**
3. 点击 **Edge Functions**

### **第 2 步：打开 cleanup-old-orders 函数**
1. 在 Edge Functions 列表中找到 **cleanup-old-orders**
2. 点击打开

### **第 3 步：测试并执行**
1. 点击右上角的 **Test** 按钮
2. 根据需要选择请求体：

**选项 A：仅预览（推荐先做一次）**
```json
{
  "dryRun": true,
  "retentionDays": 60
}
```
点击 **Send** → 会显示**会删除多少订单**，但不实际删除

**选项 B：实际删除**
```json
{
  "dryRun": false,
  "retentionDays": 60
}
```
点击 **Send** → 开始实际删除

---

## 📊 运行结果解读

### **成功响应示例：**
```json
{
  "success": true,
  "dryRun": false,
  "deletedOrders": 150,
  "deletedOrderItems": 450,
  "deletedSyncLogs": 2000,
  "message": "Successfully deleted 150 completed orders older than 60 days"
}
```

| 字段 | 含义 |
|------|------|
| `success` | 是否成功 |
| `dryRun` | 是否为预览模式 |
| `deletedOrders` | 删除的订单数 |
| `deletedOrderItems` | 删除的订单项数 |
| `deletedSyncLogs` | 删除的日志记录数 |
| `message` | 详细信息 |

---

## 📅 推荐使用频率

| 频率 | 说明 |
|------|------|
| **每周一次** | 定期清理，保持数据库轻量 |
| **每月一次** | 最少要求，防止超限 |
| **需要时** | 存储用量接近限制时立即执行 |

---

## ✅ 操作检查清单

每次运行前检查：

- [ ] 确认要删除的是**已完成订单**（已发货）
- [ ] 确认不会删除**未完成订单**（还在处理中）
- [ ] 可选：先运行 `dryRun: true` 预览结果
- [ ] 确认准备好后再运行 `dryRun: false` 实际删除

---

## 🔒 安全保障

**此清理函数保证：**

✅ **只删除：**
- ✓ `order_status = 'completed'` 的订单
- ✓ 创建时间超过 60 天的记录
- ✓ 关联的 order_items
- ✓ 旧的 sync_logs

✅ **永不删除：**
- ✗ 未完成订单（任何状态都不会删除）
- ✗ 60 天内的任何数据
- ✗ 产品信息、库存、用户数据
- ✗ 平台账户信息

---

## 📈 存储监控

### **检查数据库大小：**

1. Supabase Dashboard 首页
2. 查看 **Database Size** 卡片
3. 对比上次运行后的变化

**目标：** 保持在 5M 行以下（免费层限制）

### **查看清理历史：**

在 SQL 编辑器中运行：
```sql
SELECT 
  created_at,
  action,
  status,
  message
FROM sync_logs
WHERE action = 'cleanup_old_orders'
ORDER BY created_at DESC
LIMIT 20;
```

---

## 🆘 常见问题

### **Q: 可以删除 90 天以上的数据吗？**
**A:** 可以。修改请求体中的 `retentionDays`:
```json
{
  "dryRun": false,
  "retentionDays": 90
}
```

### **Q: 删除后能恢复吗？**
**A:** 不能。硬删除是永久的。建议先用 `dryRun: true` 预览。

### **Q: 多久要运行一次？**
**A:** 根据你的订单量：
- 5000 订单/天 → 每周一次
- 1000 订单/天 → 每月一次

### **Q: 为什么不能自动删除？**
**A:** 由于网络限制，无法从 GitHub Actions 访问 Supabase API。手动运行既然已经可行，就采用这个方案。

---

## 📞 需要帮助？

如果在 Dashboard 中找不到清理函数或运行失败：

1. 检查你在 **Edge Functions** 标签
2. 确认函数名称是 **cleanup-old-orders**
3. 查看 **Logs** 标签中的错误信息
4. 如果问题仍未解决，检查项目是否升级到 **Pro** 计划

---

## ✨ 总结

**这个方案的好处：**
- ✅ 不需要 VPN 或特殊配置
- ✅ 可以立即看到结果
- ✅ 完全在你的控制下
- ✅ 安全可靠
- ✅ 简单易用

**下次清理时：** 打开 Supabase Dashboard → Edge Functions → cleanup-old-orders → Test → 输入请求体 → Send

就这么简单！🎉

---

**最后一次运行时间：** 2026-09-06
**下一次预计运行：** 2026-09-13（如果按周运行）
