import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://dtttdgdkhayzchmfptjt.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'your-key-here';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log('🔍 排查订单 586077177301730791...\n');

// 1. 检查订单是否存在
console.log('1️⃣ 检查订单表中是否存在该订单:');
const { data: order, error: orderErr } = await supabase
  .from('orders')
  .select('id, order_no, platform, platform_status, order_status, created_at, updated_at')
  .eq('order_no', '586077177301730791')
  .single();

if (orderErr && orderErr.code !== 'PGRST116') {
  console.error('❌ 数据库查询错误:', orderErr);
} else if (!order) {
  console.log('❌ 订单 NOT FOUND - 数据库中不存在\n');
} else {
  console.log('✅ 订单已在数据库中:');
  console.log('   ID:', order.id);
  console.log('   状态:', order.order_status);
  console.log('   平台状态:', order.platform_status);
  console.log('   创建时间:', order.created_at);
  console.log('   更新时间:', order.updated_at);
}

// 2. 检查同步日志
console.log('\n2️⃣ 检查同步日志中是否有该订单的记录:');
const { data: logs } = await supabase
  .from('sync_logs')
  .select('action, status, message, created_at')
  .or(`message.ilike.586077177301730791,message.ilike.586077177301730791`)
  .order('created_at', { ascending: false })
  .limit(10);

if (logs && logs.length > 0) {
  console.log(`✅ 找到 ${logs.length} 条相关日志:`);
  logs.forEach((log, i) => {
    console.log(`\n   [${i+1}] ${log.action} - ${log.status}`);
    console.log(`       时间: ${log.created_at}`);
    if (log.message.length > 100) {
      console.log(`       信息: ${log.message.substring(0, 100)}...`);
    } else {
      console.log(`       信息: ${log.message}`);
    }
  });
} else {
  console.log('❌ 同步日志中没有该订单的相关记录\n');
}

// 3. 检查最近的 TikTok 同步任务
console.log('\n3️⃣ 检查最近的 TikTok 同步任务:');
const { data: recentSyncs } = await supabase
  .from('sync_logs')
  .select('action, status, message, created_at')
  .eq('action', 'tiktok_sync_shop')
  .order('created_at', { ascending: false })
  .limit(5);

if (recentSyncs && recentSyncs.length > 0) {
  console.log(`最近 5 次 TikTok 同步:`);
  recentSyncs.forEach((sync, i) => {
    console.log(`\n   [${i+1}] ${sync.status.toUpperCase()}`);
    console.log(`       时间: ${sync.created_at}`);
    console.log(`       信息: ${sync.message}`);
  });
}

// 4. 检查订单是否在其他表中（如 adjustments, settlements）
console.log('\n4️⃣ 检查订单是否在其他表中...');
const tables = ['order_settlements', 'adjustments', 'order_items'];
for (const table of tables) {
  const { data, error } = await supabase
    .from(table)
    .select('count', { count: 'exact' })
    .eq('order_no', '586077177301730791')
    .limit(1);
  
  if (!error && data) {
    console.log(`   ${table}: 有关联数据`);
  }
}

console.log('\n✅ 排查完毕\n');
