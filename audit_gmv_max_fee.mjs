import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log('\n🔍 === GMV Max Ad Fee 审计 ===\n');

// 测试订单号
const testOrderNo = '586283716130080736';

console.log(`检查订单: ${testOrderNo}\n`);

// 1. 查询 order_settlements 表中该订单的数据
console.log('📋 [1] order_settlements 表中的数据:');
const { data: settlement } = await supabase
  .from('order_settlements')
  .select('*')
  .eq('order_no', testOrderNo);

if (!settlement || settlement.length === 0) {
  console.log('❌ 未找到该订单的 settlement 记录');
} else {
  const s = settlement[0];
  console.log(`✅ 找到记录`);
  console.log(`   - tiktok_gmv_max_ad_fee: ${s.tiktok_gmv_max_ad_fee || '(null)'}`);
  console.log(`   - total_fees: ${s.total_fees}`);
  console.log(`   - tiktok_settlement_amount: ${s.tiktok_settlement_amount}`);

  // 检查 raw_response
  if (s.raw_response) {
    console.log('\n📝 [2] raw_response 中的 statement_transactions:');
    const raw = s.raw_response;

    if (raw.statement_transactions && Array.isArray(raw.statement_transactions)) {
      const txn = raw.statement_transactions[0];

      if (txn) {
        console.log('\n   所有费用字段:');
        const feeFields = [
          'transaction_fee_amount',
          'platform_commission_amount',
          'shipping_fee_amount',
          'affiliate_commission_amount',
          'affiliate_partner_commission_amount',
          'affiliate_ads_commission_amount',
          'gmv_max_ad_fee_amount',  // ← 关键字段
          'platform_discount_amount',
          'settlement_amount',
          'platform_support_amount',
          'platform_discount_from_platform_amount',
          'platform_discount_from_affiliate_amount',
          'voucher_xtra_discount_amount',
          'bxp_amount',
        ];

        feeFields.forEach(field => {
          const value = txn[field];
          if (value !== undefined && value !== null) {
            console.log(`   ✅ ${field}: ${value}`);
          }
        });

        // 检查是否有我们遗漏的字段
        console.log('\n   🔎 raw_response 中所有顶级键:');
        console.log('   ', Object.keys(raw).join(', '));

        console.log('\n   🔎 statement_transactions[0] 中所有键:');
        const keys = Object.keys(txn);
        console.log(`   (共 ${keys.length} 个字段)`);
        keys.forEach(k => {
          if (k.includes('fee') || k.includes('amount') || k.includes('discount') || k.includes('commission')) {
            console.log(`   - ${k}: ${txn[k]}`);
          }
        });
      }
    } else {
      console.log('   ⚠️ raw_response 中无 statement_transactions 数据');
    }
  } else {
    console.log('   ⚠️ raw_response 为 null');
  }
}

// 2. 检查 order_settlements 表的列定义
console.log('\n📊 [3] 检查 order_settlements 表是否有 tiktok_gmv_max_ad_fee 列:');

// 查看是否可以读取该列
const { data: testFetch } = await supabase
  .from('order_settlements')
  .select('order_no, tiktok_gmv_max_ad_fee')
  .limit(1);

if (testFetch && testFetch.length > 0) {
  console.log('✅ tiktok_gmv_max_ad_fee 列存在');
  console.log(`   样本值: ${testFetch[0].tiktok_gmv_max_ad_fee || '(null)'}`);
} else {
  console.log('⚠️ 无法确认列是否存在（表可能为空）');
}

console.log('\n' + '='.repeat(60));
console.log('🎯 关键问题:');
console.log('='.repeat(60));
console.log(`
1. tiktok-settlement-sync 中是否提取了 gmv_max_ad_fee_amount?
   → 需要检查 index.ts 中的 sum() 调用

2. TikTok API 是否返回了 gmv_max_ad_fee_amount 字段?
   → 检查 raw_response 中的实际字段

3. 当前显示的 RM2.01 是来自:
   a) TikTok API 真实数据?
   b) 还是公式计算 (GMV × 5%)?

4. 订单 ${testOrderNo} 的真实 GMV Max fee 应该是多少?
   → 来源: TikTok Seller Center 的官方数据
`);

console.log('\n');
