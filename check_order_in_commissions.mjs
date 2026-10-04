import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const orderId = '586077177301730791';

console.log(`\n🔍 在 tiktok_affiliate_commissions 表中搜索订单 ${orderId}...\n`);

// 检查表的结构和数据
const { data: commissions, error } = await supabase
  .from('tiktok_affiliate_commissions')
  .select('*')
  .eq('order_id', orderId)
  .limit(10);

if (error) {
  console.log('❌ 错误:', error.message);
} else {
  console.log(`✅ 结果: ${commissions ? commissions.length : 0} 条记录\n`);

  if (commissions && commissions.length > 0) {
    commissions.forEach((row, idx) => {
      console.log(`[${idx}]`, JSON.stringify(row, null, 2));
    });
  }
}

// 获取表的样本数据（前 5 条）来理解结构
console.log('\n📋 tiktok_affiliate_commissions 表样本数据:\n');

const { data: sample } = await supabase
  .from('tiktok_affiliate_commissions')
  .select('*')
  .limit(3);

if (sample && sample.length > 0) {
  sample.forEach((row, idx) => {
    console.log(`[样本 ${idx}]`);
    console.log('  列:', Object.keys(row).join(', '));
    console.log('  值:', JSON.stringify(row, null, 2).substring(0, 200));
    console.log();
  });
}

// 查看是否有任何地方包含该订单号
console.log('\n🔎 执行全表搜索...\n');

const { data: allCommissions } = await supabase
  .from('tiktok_affiliate_commissions')
  .select('*')
  .limit(100);

if (allCommissions && allCommissions.length > 0) {
  const matches = allCommissions.filter((row) => {
    return JSON.stringify(row).includes(orderId);
  });

  if (matches.length > 0) {
    console.log(`✅ 找到 ${matches.length} 条包含订单号的记录:`);
    matches.forEach((row) => {
      console.log(`   ${JSON.stringify(row).substring(0, 150)}`);
    });
  } else {
    console.log(`❌ 在前 100 条记录中未找到包含订单号的数据`);
  }
}

console.log('\n');
