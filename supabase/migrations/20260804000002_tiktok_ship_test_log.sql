-- Standalone log table for the Ship Package API test tool. Not read or
-- written by tiktok-sync-orders or any existing sync logic — isolated to
-- the new tiktok-ship-package-test Edge Function only.
create table public.tiktok_ship_test_log (
  id uuid primary key default gen_random_uuid(),
  order_no text not null,
  package_id text,
  shipping_provider_id text,
  tracking_number text,
  request_payload jsonb,
  response_status int,
  response_body jsonb,
  result_order_status text,
  called_by text,
  called_at timestamptz not null default now()
);

alter table public.tiktok_ship_test_log enable row level security;

create policy "tiktok_ship_test_log: insert authenticated"
  on public.tiktok_ship_test_log for insert
  with check (auth.uid() is not null);

create policy "tiktok_ship_test_log: read all authenticated"
  on public.tiktok_ship_test_log for select
  using (auth.uid() is not null);
