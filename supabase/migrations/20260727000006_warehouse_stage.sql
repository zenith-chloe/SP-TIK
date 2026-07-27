-- Warehouse fulfillment workflow (print -> pick -> pack -> ready to ship),
-- tracked entirely independent of orders.order_status. order_status is
-- recomputed and overwritten by tiktok-sync-orders/shopee-sync-orders on
-- every sync run from the platform's own status, so any internal warehouse
-- progress stored there would get silently clobbered by the next sync.
-- warehouse_stage is never touched by the sync functions.

alter table public.orders add column warehouse_stage text not null default 'pending'
  check (warehouse_stage in ('pending','printed','picking','picked','packing','packed','ready_ship'));

create index idx_orders_warehouse_stage on public.orders(warehouse_stage);

create table public.warehouse_action_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  action text not null,        -- 'printed' | 'picked' | 'packed'
  from_stage text,
  to_stage text,
  staff_email text,
  created_at timestamptz not null default now()
);
create index idx_warehouse_action_log_order_id on public.warehouse_action_log(order_id);

alter table public.warehouse_action_log enable row level security;

create policy "warehouse_action_log: insert authenticated" on public.warehouse_action_log
  for insert to public with check (auth.uid() is not null);

create policy "warehouse_action_log: read all authenticated" on public.warehouse_action_log
  for select to public using (auth.uid() is not null);
