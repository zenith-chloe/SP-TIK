-- Phase 1: support incremental frontend refresh instead of full-table reload every 20s.
-- Adds an index so `updated_at > lastSyncAt` queries can use it, and triggers so every
-- write path (not just the sync edge functions, which already set updated_at manually)
-- bumps updated_at automatically.

create index if not exists idx_orders_updated_at on public.orders (updated_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_orders_set_updated_at on public.orders;
create trigger trg_orders_set_updated_at
  before update on public.orders
  for each row
  execute function public.set_updated_at();

drop trigger if exists trg_products_set_updated_at on public.products;
create trigger trg_products_set_updated_at
  before update on public.products
  for each row
  execute function public.set_updated_at();
