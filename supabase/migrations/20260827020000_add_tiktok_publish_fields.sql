-- Real TikTok product-publish tracking (2026-08-27, explicit request) —
-- distinct from the existing 'marked_published' status, which the
-- 2026-08-24 table comment explicitly documents as "Never set by any
-- automated API call" (a deliberate staff-self-report status for when no
-- real publish API existed). This adds a genuinely automated status,
-- 'api_published', only ever set after a real TikTok Create Product API
-- call returns success — the old manual states are untouched.
alter table product_listing_stores
  drop constraint if exists product_listing_stores_publish_status_check,
  add constraint product_listing_stores_publish_status_check
    check (publish_status in ('pending', 'marked_published', 'api_published', 'api_failed'));

alter table product_listing_stores
  -- Real TikTok product_id returned by a successful Create Product call —
  -- needed for any future price-update/edit call against this same listing.
  add column if not exists platform_product_id text,
  -- Real TikTok sku ids returned per-SKU, keyed by our own seller_sku, e.g.
  -- {"MY-SKU-1": "72830...id"} — needed for per-SKU price updates later.
  add column if not exists platform_sku_ids jsonb,
  add column if not exists publish_error text,
  add column if not exists published_at timestamptz;
