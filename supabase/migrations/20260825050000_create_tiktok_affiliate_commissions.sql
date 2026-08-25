-- TikTok 达人佣金 (2026-08-25) — real per-order-SKU data from the Affiliate
-- Seller API (POST /affiliate_seller/202410/orders/search), confirmed
-- live-accessible now that KSG's fresh token carries
-- seller.affiliate_collaboration.read (previously 105005-blocked before
-- this shop's reauth — see tiktok-sync-orders top-of-file history).
-- commission_rate is TikTok's raw value in hundredths-of-a-percent
-- (500 = 5.00%), verified against estimated_paid_commission /
-- estimated_commission_base ratios on real live orders (5.02%, 2.00%,
-- 5.02% for commission_rate 500/200/500 respectively).
create table if not exists tiktok_affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  platform_account_id uuid not null references platform_accounts(id) on delete cascade,
  order_no text not null,
  sku_id text not null,
  product_id text,
  creator_username text,
  content_type text,
  content_id text,
  commission_model text,
  commission_rate numeric,
  open_collaboration_id text,
  settlement_status text,
  currency text default 'MYR',
  estimated_commission_base numeric,
  estimated_paid_commission numeric,
  estimated_paid_partner_commission numeric,
  estimated_paid_shop_ads_commission numeric,
  -- actual_* only populated once settlement_status moves past To-SETTLE;
  -- TikTok returns {} (empty object) pre-settlement, which the sync
  -- normalizes to null here rather than 0, so "not yet settled" stays
  -- distinguishable from "settled at zero".
  actual_commission_base numeric,
  actual_paid_commission numeric,
  actual_paid_partner_commission numeric,
  actual_paid_shop_ads_commission numeric,
  synced_at timestamptz not null default now(),
  unique (order_no, sku_id)
);

create index if not exists idx_tiktok_affiliate_commissions_order_no on tiktok_affiliate_commissions(order_no);
create index if not exists idx_tiktok_affiliate_commissions_account on tiktok_affiliate_commissions(platform_account_id);
