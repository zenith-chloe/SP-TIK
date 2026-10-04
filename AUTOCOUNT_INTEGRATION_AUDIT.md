# AutoCount 集成审计报告
**审计日期**: 2026-09-23  
**审计范围**: Shopee/TikTok → AutoCount Sales Order 集成方案  
**状态**: ✅ 仅审计，未修改任何代码

---

## 📊 执行总结

当前 ERP 系统已为 AutoCount 集成进行了 **架构规划和数据库基础设施准备**，但 **AutoCount API 实现代码仍未完成**。系统已经为 AutoCount 设计为"唯一物理库存来源"，但与 AutoCount 的通信通路尚不存在。

---

## 1️⃣ 当前 AutoCount 集成现状

### ✅ 已完成（架构 + 数据库）

| 项目 | 状态 | 详情 |
|------|------|------|
| **数据库设计** | ✅ 完成 | 已在 `products` 表添加 `autocount_item_code` 字段（可编辑） |
| **库存调整同步字段** | ✅ 完成 | `inventory_adjustment_requests` 表有 `autocount_sync_status`（可选值：not_applicable/pending/synced/failed） + `autocount_doc_no` |
| **销售订单同步字段** | ✅ 完成 | `orders` 表有 `autocount_doc_no`（记录传送给 AutoCount 的单号）+ `autocount_do_status`（Delivery Order 状态） |
| **系统方向决策** | ✅ 完成 | **AutoCount = 唯一物理库存主数据源**<br/>- ERP 只显示已预留库存 (Reserved Stock)<br/>- 可用库存 = 物理库存 - 已预留<br/>- 实际库存扣减由 AutoCount DO (Delivery Order) 触发 |
| **库存调整UI** | ✅ 完成 | Inventory Adjustment 页面可申请调整，UI 显示 "待同步 AutoCount" 状态 |
| **配置表** | ✅ 完成 | `autocount_settings` 表存在（1行），用于存储 AutoCount 连接配置 |
| **产品主数据链接** | ✅ 完成 | `pagesProducts.jsx` 可编辑每个产品的 `autocount_item_code`（AutoCount SKU 映射） |
| **权限隔离** | ✅ 完成 | RLS 配置完成，warehouse 角色有 products 的库存数量更新权限 |

### ❌ 未完成（API 实现）

| 项目 | 状态 | 问题 |
|------|------|------|
| **AutoCount API 连接** | ❌ 无代码 | 无 Edge Function 调用 AutoCount API 创建 Sales Order |
| **库存同步实现** | ❌ 无代码 | `autocount_sync_status='pending'` 的调整记录无法传送至 AutoCount |
| **DO 创建逻辑** | ❌ 无代码 | 无"Create DO"按钮功能实现（UI 占位符存在，但无后端代码） |
| **实时回写** | ❌ 无代码 | AutoCount 的库存更新无法回写到 ERP（单向预留，未实现双向同步） |
| **错误处理** | ❌ 无代码 | 无重试机制、无错误日志表 |

---

## 2️⃣ 现有代码中的 AutoCount 相关内容

### 📂 数据库层

**表字段已准备就绪：**

```sql
-- products 表
autocount_item_code TEXT -- AutoCount 中的 item code / SKU

-- inventory_adjustment_requests 表
autocount_sync_status TEXT -- not_applicable | pending | synced | failed
autocount_doc_no TEXT       -- DO 单号

-- orders 表
autocount_doc_no TEXT       -- 传送给 AutoCount 的 Sales Order 号
autocount_do_status TEXT    -- Delivery Order 的状态

-- autocount_settings 表（1行配置）
-- 现存但未被 app code 读写
```

### 💻 前端代码（UI 已准备）

**产品管理** (`pagesProducts.jsx`):
```jsx
<label>AutoCount Item Code</label>
<input value={form.autocountItemCode} onChange={...} />
// 用户可编辑每个产品的 AutoCount item code
```

**库存调整** (`pagesInventoryAdjustment.jsx`):
```jsx
{lang === "en" ? SYNC_LABELS[r.autocountSyncStatus]?.en : ...}
// 显示 "待同步 AutoCount" / "Pending AutoCount Sync"

<th>AutoCount DO</th>
<td>{r.autocountDocNo || t("未传送", "Not sent")}</td>
// 显示 DO 单号（如果已传送）
```

**订单预留** (erp-mvp-demo.jsx):
```javascript
const productsQuery = supabaseClient
  .from("products")
  .select("..., autocount_item_code");  // 已加入查询

// 库存调整批准时：
.update({ 
  status: "approved", 
  autocount_sync_status: "pending"  // 标记为待同步
})
```

### 🔌 API/Edge Functions 层

**状态**: ❌ **完全空白**

```bash
/supabase/functions/  # 目录存在但为空
```

**需要实现的 Edge Functions**（不存在）：
- `autocount-create-sales-order` — 订单 → AutoCount SO
- `autocount-create-do` — 调整/出货 → AutoCount DO
- `autocount-sync-stock` — 接收 AutoCount 库存更新
- `autocount-check-do-status` — 轮询 DO 状态

---

## 3️⃣ 完整工作流程设计（已规划，未实现）

```
订单流程:
┌─────────────────┐
│  Shopee/TikTok  │
│   订单同步      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  ERP Orders 表                  │
│  (order_status = pending)       │
│  (warehouse_stage = pending)    │
└────────┬────────────────────────┘
         │
         ▼ [User Click: 开始打包]
┌─────────────────────────────────┐
│  warehouse_stage = printed      │
│  order_status = processing      │
└────────┬────────────────────────┘
         │
         ▼ [User Click: 完成打包]
┌─────────────────────────────────┐
│  warehouse_stage = picked       │
│  (stock RESERVED in products)   │
└────────┬────────────────────────┘
         │
         ▼ [User Click: "Create DO"]  ⚠️ NOT IMPLEMENTED
┌─────────────────────────────────┐
│  调用 AutoCount API:            │
│  POST /api/sales-order/create   │
│  - order_no: "ORD-..."          │
│  - items: [{                    │
│    - item_code: (from products) │
│    - qty: order_items.qty       │
│  }]                             │
└────────┬────────────────────────┘
         │
         ▼ AutoCount 创建 SO + DO
┌─────────────────────────────────┐
│  AutoCount 确认:                │
│  - autocount_doc_no = "DO-..."  │
│  - 扣减 Physical Stock          │
└────────┬────────────────────────┘
         │
         ▼ ERP 更新 autocount_doc_no ⚠️ NOT IMPLEMENTED
┌─────────────────────────────────┐
│  orders.autocount_doc_no = "DO-..."
│  orders.warehouse_stage = ready_ship
└─────────────────────────────────┘
```

**库存调整流程** (也未实现):
```
User 申请库存调整
    ↓
UI 创建 inventory_adjustment_request
    ↓
Owner 批准 → autocount_sync_status='pending'
    ↓
[需要 API] 调用 AutoCount → 修改库存
    ↓
[需要 API] AutoCount 确认 → autocount_sync_status='synced'
```

---

## 4️⃣ AutoCount API 集成需求分析

### 🔑 需要购买的东西

根据目前的架构，需要：

| 项目 | 需要购买 | 说明 |
|------|---------|------|
| **AutoCount API Access** | ✅ **必需** | AutoCount 的 REST/SOAP API<br/>取决于版本（v19/v20 等） |
| **OAuth / API Key** | ✅ **必需** | AutoCount 需要认证<br/>通常是 Company Code + User ID + API Key |
| **Integration License** | ❓ **咨询代理商** | AutoCount 某些版本可能需要额外 License<br/>确认是否包含在现有 License 中 |
| **Sales Order 权限** | ✅ **必需** | AutoCount 用户需要"创建销售订单"权限 |
| **Inventory 权限** | ✅ **必需** | AutoCount 用户需要"库存调整"权限 |

### 📋 需要的 AutoCount 信息

与 AutoCount 代理商确认以下信息：

```
【AutoCount 连接信息】
1. AutoCount 版本号 (v19? v20? 云版?)
2. API 端点 URL
3. 认证方式 (OAuth / API Key / Basic Auth?)
4. Company Code
5. 可用的 API 权限范围

【Sales Order 相关】
6. 创建销售订单 API 端点
7. 必填字段: Customer Code, Item Code, Qty, Price...
8. 可选字段: Reference, Notes, Warehouse Location...
9. 返回值是否包含 Sales Order No.

【DO (Delivery Order) 相关】
10. 是否需要单独创建 DO，还是自动生成
11. DO 状态有哪些: Draft, Confirmed, Picked, Shipped...
12. DO 创建是否自动扣库存，还是需要二步操作

【库存相关】
13. 库存调整 API (或 Journal 创建)
14. 库存回写 API (将实际库存返回 ERP)
15. Warehouse Code / Location 如何映射 (我们有 warehouse_a/warehouse_b)

【错误/重试】
16. API 限流规则 (RPS, 日限额)
17. 失败重试建议
18. 错误代码列表
```

---

## 5️⃣ 代码实现清单

当代理商确认上述信息后，需要实现：

### Phase 1: 基础 API 集成

```typescript
// supabase/functions/autocount-init-config.ts
// 初始化 AutoCount 连接配置到 autocount_settings

// supabase/functions/autocount-create-sales-order.ts
export async function createSalesOrderInAutocount(order) {
  // input: {
  //   order_no, customer_name, items: [{sku, qty, price}]
  // }
  // 
  // 1. 构建 AutoCount API 请求
  // 2. 调用 POST /api/sales-order/create
  // 3. 返回 AutoCount Sales Order No.
  // 4. 保存到 orders.autocount_doc_no
  // 5. 记录到 sync_logs
}

// supabase/functions/autocount-create-do.ts
export async function createDOInAutocount(orderId) {
  // 1. 获取 order + autocount_doc_no
  // 2. 调用 POST /api/delivery-order/create
  // 3. AutoCount 扣库存
  // 4. 更新 orders.autocount_do_status
}

// supabase/functions/autocount-sync-inventory-adjustment.ts
export async function syncAdjustmentToAutocount(adjustmentId) {
  // 1. 获取 adjustment_request
  // 2. 创建库存日记账分录
  // 3. 更新 autocount_sync_status='synced'
}
```

### Phase 2: 回写 + 同步

```typescript
// supabase/functions/autocount-pull-inventory.ts
// 定时任务（每小时）: 从 AutoCount 拉库存更新，写回 products.warehouse_a_qty/b_qty

// supabase/functions/autocount-check-do-status.ts
// 定时任务: 轮询 DO 状态，更新 orders.autocount_do_status
```

### Phase 3: 错误处理

```typescript
// 创建 sync_logs 表（可能已存在）
// CREATE TABLE sync_logs (
//   id UUID,
//   source TEXT,  -- 'autocount-create-so', 'autocount-sync-inventory'...
//   record_id UUID,
//   status TEXT,  -- 'success', 'failed', 'retry'
//   error_message TEXT,
//   retry_count INT,
//   next_retry_at TIMESTAMP,
//   created_at TIMESTAMP
// )

// 实现重试逻辑: status='failed' → 2h/4h/8h 后重试
```

---

## 6️⃣ 现有 UI / UX 状态

### ✅ 已准备好的 UI

1. **产品管理** → AutoCount Item Code 字段可编辑
2. **库存调整** → 显示 "待同步 AutoCount"/"Pending AutoCount Sync"
3. **订单 Drawer** → 预留位置显示 autocount_doc_no（若有值）
4. **库存调整列表** → 预留 "AutoCount DO" 列

### ❌ 缺失的 UI

- [ ] **"Create DO"按钮** — `pagesInventoryAdjustment.jsx` 有占位符注释但无实现
- [ ] **AutoCount 连接设置** — UI 不存在（需新建页面或模态框）
- [ ] **同步错误提示** — 未显示 AutoCount 返回的错误原因
- [ ] **Sync Status 实时刷新** — 需要 Supabase 实时订阅或定时轮询

---

## 7️⃣ 风险和约束

### ⚠️ 关键风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| **AutoCount API 可用性** | 如果 API 不稳定，DO 创建会失败，订单卡住 | 实现重试 + 错误日志 + 人工回退路径 |
| **Item Code 映射错误** | 订单发送错误的 AutoCount SKU，库存错乱 | 要求用户输入前验证 + API 调用前检查 |
| **库存双向同步延迟** | ERP 显示的库存可能与 AutoCount 有差异 | 实现定时同步（1h 间隔） + 显示"最后同步时间" |
| **对账困难** | 长期可能出现 ERP/AutoCount 库存不一致 | 实现月度对账功表 + 差异日志 |

### 📌 已确认的架构约束

1. **AutoCount 是库存唯一来源** — ERP 无法独立修改库存，必须通过 AutoCount API
2. **两步库存扣减**:
   - Step 1: 用户打包时 → 预留库存 (ERP products 表)
   - Step 2: 创建 DO 时 → 物理库存扣减 (AutoCount)
3. **Shopee/TikTok 都走同一个 AutoCount**（不支持多个 AutoCount 实例）

---

## 8️⃣ 建议的采购方案

### 方案A: 标准集成（推荐）

```
1. AutoCount API License / 连接权限
   └─ 大多数版本默认包含，确认代理商

2. 中文文档 + 技术支持
   └─ 确保能问到 Item Code/Customer Code/Warehouse 的正确映射

3. 测试环境访问权限
   └─ 在正式对接前验证 API
```

**预期成本**: 取决于 AutoCount 版本  
**预期周期**: 1-2 周接入，1-2 周测试

### 方案B: 第三方集成服务

```
如果 AutoCount API 文档不完善，考虑找 AutoCount 认证的集成商
```

---

## 📝 下一步行动

### 【立即做】

1. **收集 AutoCount 信息** (给代理商的清单见第 4️⃣ 节)
2. **确认 API 版本和端点**
3. **申请测试环境** (如果需要)

### 【代理商回复后】

4. 编写 Supabase Edge Functions 实现 API 调用
5. 创建 UI for AutoCount 连接设置
6. 测试端到端工作流
7. 部署到生产环境

### 【持续】

8. 实现库存回写 + 定时同步
9. 建立对账机制
10. 监控 API 错误率

---

## 📚 文件清单

**本次审计未修改任何文件。**

已读取的文件:
- `src/erp-mvp-demo.jsx` — 前端逻辑
- `src/pagesProducts.jsx` — 产品管理 UI
- `src/pagesInventoryAdjustment.jsx` — 库存调整 UI
- `src/shared.jsx` — 工具函数 + 数据映射
- `supabase/migrations/*.sql` — 数据库定义
- `PROJECT_CONTEXT.md` — 系统架构决策

**重点**:
```
autocount_item_code     ← products.autocount_item_code
autocount_sync_status   ← inventory_adjustment_requests.autocount_sync_status  
autocount_doc_no        ← orders.autocount_doc_no + DO 单号
```

---

## ✅ 审计完成

**结论**: ERP 已为 AutoCount 集成做好基础准备（数据库 + UI），但 API 实现代码仍为零。建议先与 AutoCount 代理商沟通，获取详细的 API 文档和连接参数，再规划开发时间表。
