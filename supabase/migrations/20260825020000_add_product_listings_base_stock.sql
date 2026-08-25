-- 基础库存 (2026-08-25) — used only in single-SKU mode (多规格开关关闭时),
-- mirrors base_price's role. When variants are on, stock lives per-SKU on
-- product_listing_variations.stock instead; this column is simply ignored
-- (left as-is) in that case, not deleted, so toggling back off restores it.
alter table product_listings
  add column if not exists base_stock integer;
