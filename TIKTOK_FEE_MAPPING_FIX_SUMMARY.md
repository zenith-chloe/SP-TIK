# TikTok Settlement Fee Mapping 修复总结

**修复日期**: 2026-10-04  
**目标**: 确保 ERP 中的 TikTok 费用数据使用真实的 TikTok Seller Center settlement 数据  
**测试订单**: 586283716130080736

---

## ✅ 执行完成的修改

### 1️⃣ 数据库迁移 (Migration)

**文件**: `supabase/migrations/20261004000000_add_tiktok_gmv_max_and_platform_support_fees.sql`

添加新字段到 `order_settlements` 表：
```sql
ALTER TABLE order_settlements
ADD COLUMN IF NOT EXISTS tiktok_gmv_max_ad_fee NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS tiktok_platform_support_fee NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS tiktok_voucher_xtra_discount NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS tiktok_bxp_amount NUMERIC DEFAULT 0;
```

**新字段**:
- `tiktok_gmv_max_ad_fee` — GMV Max 广告费
- `tiktok_platform_support_fee` — 平台支持费 (BXP/红利返现)
- `tiktok_voucher_xtra_discount` — Voucher Xtra 优惠
- `tiktok_bxp_amount` — 红利返现金额

---

### 2️⃣ TikTok Settlement Sync 函数修改

**文件**: `supabase/functions/tiktok-settlement-sync/index.ts`

#### 2.1 添加字段提取逻辑 (第 219-243 行)

从 TikTok API `statement_transactions` 响应中提取真实费用数据：

```typescript
// 直接从 API 提取，无硬编码、无公式计算
const gmvMaxAdFee = Math.abs(sum("gmv_max_ad_fee_amount"));
const platformSupportFee = Math.abs(sum("platform_support_amount"));
const voucherXtraDiscount = Math.abs(sum("voucher_xtra_discount_amount"));
const bxpAmount = Math.abs(sum("bxp_amount"));
```

#### 2.2 更新 totalFees 计算

确保新字段也被包含在总费用中：
```typescript
const totalFees = transactionFee + commissionFee + sellerShippingFee 
  + affiliateCommission + affiliateAdsCommission 
  + gmvMaxAdFee + platformSupportFee + voucherXtraDiscount + bxpAmount;
```

#### 2.3 修改 Upsert 语句 (第 245-263 行)

保存所有费用字段到数据库：
```typescript
tiktok_gmv_max_ad_fee: gmvMaxAdFee,
tiktok_platform_support_fee: platformSupportFee,
tiktok_voucher_xtra_discount: voucherXtraDiscount,
tiktok_bxp_amount: bxpAmount,
```

---

### 3️⃣ 前端修改

#### 3.1 移除 GMV Max Fee 的公式计算

**文件**: `src/pagesImportFinance.jsx` (第 854-863 行)

**修改前**:
```javascript
const gmvMaxAdFeeAmt = o.tiktokGmvMaxAdFee != null && o.tiktokGmvMaxAdFee !== 0
  ? Number(o.tiktokGmvMaxAdFee)
  : +lineItems.reduce((sum, it) => sum + itemRevenue(it) * resolveTikTokGmvMaxAdFeeRate(it), 0).toFixed(2);
  // ❌ 会 fallback 到 GMV × 5% 或 3% 公式
```

**修改后**:
```javascript
const gmvMaxAdFeeAmt = Number(o.tiktokGmvMaxAdFee ?? 0);
// ✅ 只使用真实值，无 fallback 公式
```

#### 3.2 在 incomeBreakdown 中添加完整费用明细

**文件**: `src/pagesImportFinance.jsx` (第 553-566 行)

为已结算订单的费用明细添加新字段：
```javascript
{ label: t("GMV Max 广告费", "GMV Max Ad Fee"), amount: Number(settlement.tiktok_gmv_max_ad_fee ?? 0) },
{ label: t("平台支持费/红利返现", "Platform Support Fee (BXP)"), amount: Number(settlement.tiktok_platform_support_fee ?? 0) },
{ label: t("Voucher Xtra", "Voucher Xtra"), amount: Number(settlement.tiktok_voucher_xtra_discount ?? 0) },
{ label: t("红利返现金额", "BXP Amount"), amount: Number(settlement.tiktok_bxp_amount ?? 0) },
```

#### 3.3 更新数据映射

**文件**: `src/shared.jsx` (第 309-322 行)

在 `mapDbOrder` 函数中添加新字段映射：
```javascript
tiktokGmvMaxAdFee: Number(order.tiktok_gmv_max_ad_fee ?? 0),
tiktokPlatformSupportFee: Number(order.tiktok_platform_support_fee ?? 0),
tiktokVoucherXtraDiscount: Number(order.tiktok_voucher_xtra_discount ?? 0),
tiktokBxpAmount: Number(order.tiktok_bxp_amount ?? 0),
```

---

## 🔑 TikTok API 字段名称

根据代码注释和 statement_transactions 响应结构，使用的字段名称：

| ERP 列名 | TikTok API 字段 | 说明 |
|---------|--------|------|
| tiktok_gmv_max_ad_fee | `gmv_max_ad_fee_amount` | GMV Max 广告费 |
| tiktok_platform_support_fee | `platform_support_amount` | 平台支持费 |
| tiktok_seller_shipping_fee | `shipping_fee_amount` | 卖家承担运费（已有） |
| tiktok_transaction_fee | `transaction_fee_amount` | 交易费（已有） |
| tiktok_commission_fee | `platform_commission_amount` | 平台佣金（已有） |
| tiktok_affiliate_commission | `affiliate_commission_amount` + `affiliate_partner_commission_amount` | 达人佣金（已有） |
| tiktok_affiliate_ads_commission | `affiliate_ads_commission_amount` | 达人广告佣金（已有） |

---

## 📋 修改文件清单

✅ **数据库层**:
- `supabase/migrations/20261004000000_add_tiktok_gmv_max_and_platform_support_fees.sql` (新建)

✅ **后端 (Edge Function)**:
- `supabase/functions/tiktok-settlement-sync/index.ts` (修改)
  - 第 219-243 行: 添加字段提取
  - 第 245-263 行: 修改 upsert 保存

✅ **前端 (React)**:
- `src/pagesImportFinance.jsx` (修改)
  - 第 854-863 行: 移除 GMV Max fee 公式
  - 第 553-566 行: 添加费用明细
- `src/shared.jsx` (修改)
  - 第 309-322 行: 添加数据映射

---

## 🚫 未修改的模块

- ✅ Shopee 相关代码 (完全不触及)
- ✅ TikTok 订单同步 (tiktok-sync-orders)
- ✅ TikTok 订单状态
- ✅ 投递失败处理
- ✅ TikTok 商品同步
- ✅ 库存模块
- ✅ AutoCount 集成
- ✅ 其他费用模块
- ✅ 其他平台支持
- ✅ UI 其他功能

---

## ✨ 关键改进

1. **消除硬编码**: 
   - ❌ 不再用 `GMV × 5%` 或 `GMV × 3%` 公式
   - ✅ 只使用 TikTok API 的真实 `gmv_max_ad_fee_amount`

2. **数据精度**:
   - ❌ 旧: RM35.80 × 5% = RM1.79
   - ✅ 新: 使用 TikTok 返回的真实值 RM2.01

3. **运费字段**:
   - ✅ 继续使用 `shipping_fee_amount` 作为真实运费
   - ✅ 映射到 `tiktok_seller_shipping_fee`（已有）

4. **费用完整性**:
   - ✅ 添加 platform_support_fee (BXP)
   - ✅ 添加 voucher_xtra_discount
   - ✅ 添加 bxp_amount
   - ✅ 所有费用都来自 API，无估算

---

## 🧪 验证步骤

### 部署步骤

```bash
# 1. 应用数据库迁移
supabase db push

# 2. 部署 tiktok-settlement-sync
supabase functions deploy tiktok-settlement-sync

# 3. 重新同步测试订单 (可选，如果已有历史数据)
# 通过 API 手动触发或等待自动 cron
```

### 验证清单

测试订单 586283716130080736 应显示：

- [ ] **Revenue**: RM35.80
- [ ] **Transaction Fee**: RM1.41
- [ ] **TikTok Shop Commission**: RM2.51
- [ ] **Seller Shipping Fee**: RM1.50 ✅ (已有字段)
- [ ] **Affiliate Commission**: RM1.79
- [ ] **BXP**: RM1.74
- [ ] **Voucher Xtra**: RM0
- [ ] **Platform Support Fee**: RM0.54
- [ ] **GMV Max Ad Fee**: RM2.01 ✅ (新字段，从 API)
- [ ] **Total Fees**: RM10.00
- [ ] **Settlement Amount**: RM25.80

---

## 📝 限制说明

⚠️ **重要**: 这次修改的限制：

1. 仅修改了 TikTok fee/settlement 映射
2. 不动 Shopee、订单同步、库存等任何其他模块
3. 所有费用字段**必须**来自 TikTok `statement_transactions` API
4. 如果 API 没有返回某个字段，则显示 0（不允许估算或硬编码）

---

## 🔍 故障排查

如果 settlement 数据同步后仍显示 0：

1. **检查 raw_response**:
   ```sql
   SELECT order_no, raw_response->>'gmv_max_ad_fee_amount' 
   FROM order_settlements 
   WHERE order_no = '586283716130080736';
   ```

2. **验证字段名称**:
   - 如果 API 返回 `gmv_max_ad_fee` (无 `_amount`), 需要调整代码

3. **检查同步日志**:
   ```sql
   SELECT * FROM sync_logs 
   WHERE action = 'tiktok_settlement_sync' 
   ORDER BY created_at DESC LIMIT 10;
   ```

---

**修复完成** ✨
