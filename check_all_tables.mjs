import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dtttdgdkhayzchmfptjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0dHRkZ2RraGF5emNobWZwdGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzIxNTEsImV4cCI6MjA5OTM0ODE1MX0.9B7bVr79kee9QbrsbpVbyiBwlla_2QlCO_3d2u4g0kY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log('\n🔍 检查所有表的记录数...\n');
console.log('='.repeat(70));

// 可能包含订单相关数据的表列表
const tables = [
  // 标准 ERP 表
  'orders',
  'order_items',
  'order_settlements',
  'settlement_transactions',

  // TikTok 相关表
  'tiktok_orders',
  'tiktok_adjustments',
  'tiktok_affiliate_commissions',
  'tiktok_settlements',

  // Shopee 相关表
  'shopee_orders',
  'shopee_orders_returns',
  'shopee_settlements',

  // 一般表
  'products',
  'stock_movements',
  'sync_logs',
  'platform_accounts',
  'platform_sync_progress',
];

for (const tableName of tables) {
  try {
    const { count, error } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true });

    if (error) {
      if (error.code === 'PGRST116') {
        // 表不存在，跳过
        continue;
      }
      console.log(`❌ ${tableName.padEnd(35)} - 错误: ${error.message}`);
    } else {
      console.log(`✅ ${tableName.padEnd(35)} - ${count || 0} 行`);
    }
  } catch (e) {
    console.log(`❌ ${tableName.padEnd(35)} - 异常`);
  }
}

console.log('='.repeat(70));
console.log('\n🔎 尝试搜索订单号 586077177301730791...\n');

// 在每个订单相关的表中搜索
const orderSearchTables = [
  'orders',
  'tiktok_orders',
  'tiktok_adjustments',
  'order_settlements',
];

for (const tableName of orderSearchTables) {
  try {
    // 尝试查询包含这个订单号的任何记录
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .ilike('*', '%586077177301730791%');

    if (!error && data && data.length > 0) {
      console.log(`\n✅ 在 ${tableName} 表找到 ${data.length} 条记录:`);
      data.forEach((row) => {
        console.log(`   ${JSON.stringify(row).substring(0, 100)}`);
      });
    }
  } catch (e) {
    // 忽略
  }
}

console.log('\n');
