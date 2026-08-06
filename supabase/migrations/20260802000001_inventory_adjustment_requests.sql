-- Inventory Adjustment (approval-gated). AutoCount remains the sole Physical
-- Stock Master, so approving a request here does NOT write
-- products.warehouse_a_qty/b_qty. It only records that owner approval
-- happened and flips autocount_sync_status to 'pending' -- actual stock sync
-- happens once a real AutoCount API integration exists.
create table public.inventory_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id),
  sku text not null,
  qty_change integer not null,
  reason text not null,
  requested_by text not null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  approved_by text,
  approved_at timestamptz,
  autocount_sync_status text not null default 'not_applicable'
    check (autocount_sync_status in ('not_applicable','pending','synced','failed')),
  autocount_doc_no text
);

alter table public.inventory_adjustment_requests enable row level security;

create policy "inventory_adjustment_requests: authenticated read" on public.inventory_adjustment_requests
  for select using (auth.role() = 'authenticated');

create policy "inventory_adjustment_requests: authenticated create" on public.inventory_adjustment_requests
  for insert with check (auth.role() = 'authenticated');

create policy "inventory_adjustment_requests: owner approve/reject" on public.inventory_adjustment_requests
  for update using ("current_role"() = 'owner') with check ("current_role"() = 'owner');
