-- TikTok Shop-specific listing upgrade (2026-08-24). Added to
-- product_listings / product_listing_variations (this module's own tables),
-- deliberately NOT to `products` (the real AutoCount-synced stock master --
-- see AutoCount system-direction memory: AutoCount is sole stock master).
-- Putting TikTok-only fields like a product video or COD toggle onto the
-- real products table would pollute a table AutoCount owns with
-- platform-specific junk that has nothing to do with stock/pricing.
alter table product_listings
  add column if not exists is_cod boolean not null default false,
  -- UI-only unit preference for the weight input (g vs kg quick toggle);
  -- weight_kg itself stays the single canonical stored value in kg either way.
  add column if not exists weight_unit text not null default 'kg' check (weight_unit in ('g', 'kg')),
  -- Product video (2026-08-24) -- uploaded to the new product-videos storage
  -- bucket (see below), this is the real public URL, not a data: URI (a
  -- video is too large to store inline the way the watermark image data
  -- URL does).
  add column if not exists video_url text,
  -- Real TikTok brand id, when the official Brand List API succeeds (same
  -- Product-scope dependency as categories -- see tiktok-sync-orders'
  -- 2026-08-24 notes). `brand` (free text) stays as the fallback/manual
  -- value used when the real API isn't available yet.
  add column if not exists tiktok_brand_id text;

alter table product_listing_variations
  add column if not exists weight_kg numeric;

-- Storage bucket for product videos -- public read (product videos are
-- meant to be shown in listings), writes still gated by RLS below to
-- authenticated staff only.
insert into storage.buckets (id, name, public)
values ('product-videos', 'product-videos', true)
on conflict (id) do nothing;

create policy "product-videos: public read"
  on storage.objects for select
  using (bucket_id = 'product-videos');

create policy "product-videos: authenticated upload"
  on storage.objects for insert
  with check (bucket_id = 'product-videos' and auth.uid() is not null);

create policy "product-videos: authenticated delete own"
  on storage.objects for delete
  using (bucket_id = 'product-videos' and auth.uid() is not null);
