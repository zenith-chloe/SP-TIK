-- 内部维护的类目库 (2026-08-24) — NOT a live sync of Shopee/TikTok's real
-- category trees. Confirmed live (2026-08-24, via a temporary debug probe
-- against TikTok's real GET /product/202309/categories, called through a
-- real logged-in session): this app's TikTok Partner Center approval
-- returns error 105005 "Access denied ... access scopes ... do not contain
-- the required access scope" — Product-category API access is not granted.
-- Shopee's product-category API is equally unintegrated (no edge function
-- for it exists in this project). Until that scope is separately requested
-- and approved, this table is staff-maintained: a curated, editable list of
-- categories (see category management UI in pagesProductListing.jsx),
-- seeded with a small illustrative starter set — NOT verified against
-- either platform's live real taxonomy, so treat the wording as
-- placeholder/representative, not authoritative.
create table if not exists category_trees (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('Shopee', 'TikTok Shop')),
  level1 text not null,
  level2 text not null,
  level3 text not null,
  created_at timestamptz not null default now(),
  unique (platform, level1, level2, level3)
);

-- Mandatory/optional attribute placeholders bound to one leaf category
-- (e.g. Material, Warranty Type). Also staff-maintained, not fetched from
-- either platform's real per-category attribute schema.
create table if not exists category_attribute_templates (
  id uuid primary key default gen_random_uuid(),
  category_leaf_id uuid not null references category_trees(id) on delete cascade,
  attr_name text not null,
  required boolean not null default true,
  created_at timestamptz not null default now()
);

alter table category_trees enable row level security;
alter table category_attribute_templates enable row level security;

create policy "category_trees: read all authenticated" on category_trees
  for select using (auth.uid() is not null);
create policy "category_trees: authenticated manage" on category_trees
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "category_attribute_templates: read all authenticated" on category_attribute_templates
  for select using (auth.uid() is not null);
create policy "category_attribute_templates: authenticated manage" on category_attribute_templates
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- Bind a listing's chosen leaf category (drives which attribute template
-- renders); the existing shopee_category_path/tiktok_category_path jsonb
-- columns stay as a materialized [level1,level2,level3] display copy so the
-- listing table doesn't need a join to show the path.
alter table product_listings
  add column if not exists shopee_category_leaf_id uuid references category_trees(id),
  add column if not exists tiktok_category_leaf_id uuid references category_trees(id);

-- Illustrative starter set (motorcycle-parts-relevant, matching this ERP's
-- real product catalog) — staff should edit/expand via the category
-- management UI, not treat this seed as authoritative official taxonomy.
insert into category_trees (platform, level1, level2, level3) values
  ('Shopee', 'Automotive', 'Motorcycle Accessories', 'Brake Parts'),
  ('Shopee', 'Automotive', 'Motorcycle Accessories', 'Batteries'),
  ('Shopee', 'Automotive', 'Motorcycle Accessories', 'Lighting'),
  ('Shopee', 'Automotive', 'Motorcycle Accessories', 'Engine Parts'),
  ('TikTok Shop', 'Automotive & Motorcycle', 'Motorcycle Parts', 'Brake System'),
  ('TikTok Shop', 'Automotive & Motorcycle', 'Motorcycle Parts', 'Electrical & Batteries'),
  ('TikTok Shop', 'Automotive & Motorcycle', 'Motorcycle Parts', 'Lighting'),
  ('TikTok Shop', 'Automotive & Motorcycle', 'Motorcycle Parts', 'Engine Parts')
on conflict do nothing;

insert into category_attribute_templates (category_leaf_id, attr_name, required)
select id, 'Material', true from category_trees where level3 in ('Brake Parts', 'Brake System', 'Engine Parts')
union all
select id, 'Compatible Model', true from category_trees where level3 in ('Brake Parts', 'Brake System', 'Engine Parts')
union all
select id, 'Warranty Type', true from category_trees where level3 in ('Batteries', 'Electrical & Batteries')
union all
select id, 'Voltage', false from category_trees where level3 in ('Batteries', 'Electrical & Batteries')
union all
select id, 'Warranty Type', false from category_trees where level3 = 'Lighting'
on conflict do nothing;
