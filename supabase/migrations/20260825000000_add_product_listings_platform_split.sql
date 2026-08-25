-- 平台彻底解耦 (2026-08-25) — product_listings rows are now single-platform:
-- each row belongs to exactly one of 'Shopee' / 'TikTok Shop', matching the
-- new /products/shopee/... vs /products/tiktok/... route split in
-- pagesProductListing.jsx. Best-effort backfill for legacy rows created
-- before this column existed (inferred from which category field was set).
alter table product_listings
  add column if not exists platform text;

update product_listings
set platform = case
  when tiktok_category_leaf_id is not null or tiktok_real_category_id is not null then 'TikTok Shop'
  when shopee_category_leaf_id is not null then 'Shopee'
  else null
end
where platform is null;
