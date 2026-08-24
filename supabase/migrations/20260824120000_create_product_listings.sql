-- 商品发布中心 (2026-08-24) — deliberately separate from `products` (the
-- real AutoCount-synced stock master, see AutoCount system-direction memory:
-- AutoCount is sole stock master). These tables never touch products.price
-- or products.*_qty; they hold e-commerce LISTING content (title/description/
-- category overrides, per-store price, publish status) that references a
-- real product by product_id for SKU/stock lookup only.
--
-- IMPORTANT (confirmed with user 2026-08-24): there is no Shopee/TikTok
-- Product API integration in this project (only Order/Settlement/
-- Fulfillment/Auth are connected) — publish_status here only ever reflects
-- what STAFF marks as done after manually publishing on the real platform.
-- Nothing in this schema or the app code that reads/writes it ever calls a
-- real Shopee/TikTok product API.
create table if not exists product_listings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id),
  sku text,
  title text not null,
  description text,
  category text,
  image_url text,
  -- Canvas-generated watermark/frame composite (2026-08-24) — a data: URL
  -- produced entirely in the browser (no external image API), see
  -- pagesProductListing.jsx for the compositing code. Left null until a
  -- frame is applied.
  watermarked_image_url text,
  base_price numeric not null default 0,
  status text not null default 'draft' check (status in ('draft', 'ready')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_listing_stores (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references product_listings(id) on delete cascade,
  platform_account_id uuid not null references platform_accounts(id),
  store_price numeric not null default 0,
  -- 'pending' = queued in ERP only; 'marked_published' = staff manually
  -- confirmed they published/updated this on the real platform themselves.
  -- Never set by any automated API call — see table comment on
  -- product_listings for why.
  publish_status text not null default 'pending' check (publish_status in ('pending', 'marked_published')),
  last_price_adjustment_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id, platform_account_id)
);

alter table product_listings enable row level security;
alter table product_listing_stores enable row level security;

create policy "product_listings: read all authenticated" on product_listings
  for select using (auth.uid() is not null);
create policy "product_listings: authenticated manage" on product_listings
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "product_listing_stores: read all authenticated" on product_listing_stores
  for select using (auth.uid() is not null);
create policy "product_listing_stores: authenticated manage" on product_listing_stores
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
