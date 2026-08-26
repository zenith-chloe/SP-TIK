-- SKU-row discount % (2026-08-27, explicit request to match TikTok Seller
-- Center's SKU table: Stock / Retail Price / Discount % / Seller SKU, with
-- the discounted sale price auto-computed client-side from these two real
-- columns). Real persisted field, not a display-only local computation.
alter table product_listing_variations
  add column if not exists discount_percent numeric not null default 0 check (discount_percent >= 0 and discount_percent <= 100);
