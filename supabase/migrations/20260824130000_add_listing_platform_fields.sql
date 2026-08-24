-- Platform-required listing fields (2026-08-24) — same scope note as the
-- product_listings table itself: these are the fields Shopee/TikTok's real
-- Product APIs require, kept here so the "发布" form can capture them
-- ahead of time, but nothing here is validated against a live category/
-- attribute API (none is connected) — category paths and attributes are
-- free-text staff entry, not fetched from Shopee/TikTok's real category
-- trees.
alter table product_listings
  add column if not exists brand text not null default 'No Brand',
  add column if not exists weight_kg numeric,
  add column if not exists length_cm numeric,
  add column if not exists width_cm numeric,
  add column if not exists height_cm numeric,
  -- TikTok hazardous-goods/battery/liquid declaration.
  add column if not exists is_dangerous boolean not null default false,
  -- Shopee per-listing shipping-channel toggles, e.g.
  -- ["Standard Delivery", "Poslaju"]. Free-text array, not validated
  -- against Shopee's real live channel list for the seller's account.
  add column if not exists shopee_shipping_channels jsonb not null default '[]'::jsonb,
  -- Each path is a free-text 3-level array, e.g.
  -- ["Automotive","Motorcycle Parts","Brake System"] — staff-entered, not
  -- pulled from either platform's real category tree (no category API
  -- connected).
  add column if not exists shopee_category_path jsonb,
  add column if not exists tiktok_category_path jsonb,
  -- Free-form mandatory-attribute placeholders (e.g. Warranty Type,
  -- Material), array of {name, value}. Not validated against either
  -- platform's real per-category required-attribute schema.
  add column if not exists attributes jsonb not null default '[]'::jsonb;

-- 多层级规格 SKU 变体 (2026-08-24)
create table if not exists product_listing_variations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references product_listings(id) on delete cascade,
  spec1_name text,
  spec1_value text,
  spec2_name text,
  spec2_value text,
  sku text,
  price numeric not null default 0,
  stock integer not null default 0,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table product_listing_variations enable row level security;

create policy "product_listing_variations: read all authenticated" on product_listing_variations
  for select using (auth.uid() is not null);
create policy "product_listing_variations: authenticated manage" on product_listing_variations
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
