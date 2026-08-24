-- Real TikTok category id (2026-08-24) — separate from
-- tiktok_category_leaf_id (which FKs to our internal category_trees table).
-- When the real TikTok Category API succeeds, the selected leaf's id comes
-- from TikTok itself (not a row in category_trees), so it can't share that
-- FK column. Plain text, no FK — this is an external platform id.
alter table product_listings
  add column if not exists tiktok_real_category_id text;
