-- TikTok 专属物流渠道 (2026-08-24) — separate from shopee_shipping_channels,
-- never rendered together (see the platform-isolation note in
-- pagesProductListing.jsx).
alter table product_listings
  add column if not exists tiktok_shipping_channels jsonb not null default '[]'::jsonb;
