-- Structured warehouse / zone / shelf / bin hierarchy, one self-referencing
-- table so a 5th level can be added later without a schema change. Seeded
-- with the two warehouses that already exist as products.warehouse_a_qty/
-- warehouse_b_qty, so "warehouse" here means the same physical place the
-- stock-quantity columns already track, not a third independent concept.
--
-- products.location (free text) is left exactly as-is; products.location_id
-- is a new, separate FK to the most specific bin a SKU is assigned to. A
-- product with no location_id just hasn't been bound to the new structure
-- yet — this doesn't touch order flow, warehouse_stage, or stock_movements.

create table public.warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.warehouse_locations(id) on delete cascade,
  level text not null check (level in ('warehouse', 'zone', 'shelf', 'bin')),
  code text not null,
  name text not null,
  created_at timestamptz not null default now()
);
create index idx_warehouse_locations_parent on public.warehouse_locations(parent_id);

alter table public.products add column location_id uuid references public.warehouse_locations(id);

alter table public.warehouse_locations enable row level security;

create policy "warehouse_locations: read all authenticated" on public.warehouse_locations
  for select to authenticated using (true);

create policy "warehouse_locations: owner manage" on public.warehouse_locations
  for all to public using ("current_role"() = 'owner') with check ("current_role"() = 'owner');

insert into public.warehouse_locations (level, code, name) values
  ('warehouse', 'A', '吉隆坡仓'),
  ('warehouse', 'B', '柔佛仓');
