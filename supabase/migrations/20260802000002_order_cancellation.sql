-- Order Cancellation Management. Deliberately does NOT touch order_status
-- (frozen, consumed by DB_TO_DEMO_STATUS) -- cancellation runs as a fully
-- separate cancel_stage lifecycle: null (Confirmed) -> 'requested' ->
-- 'cancelled'. Orders are never deleted; cancellation_records is the
-- append-style audit trail, including for orders already sent to AutoCount
-- (autocount_doc_no/autocount_do_status track manual DO rollback follow-up).
alter table public.orders add column cancel_stage text check (cancel_stage in ('requested','cancelled'));

create table public.cancellation_records (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  order_no text not null,
  channel text not null check (channel in ('shopee','tiktok')),
  sku text not null,
  product_name text,
  qty integer not null,
  customer_name text,
  reason text not null,
  autocount_doc_no text,
  autocount_do_status text,
  requested_by text not null,
  requested_at timestamptz not null default now(),
  cancelled_at timestamptz
);

alter table public.cancellation_records enable row level security;

create policy "cancellation_records: authenticated read" on public.cancellation_records
  for select using (auth.role() = 'authenticated');

create policy "cancellation_records: authenticated create" on public.cancellation_records
  for insert with check (auth.role() = 'authenticated');

create policy "cancellation_records: authenticated finalize" on public.cancellation_records
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
