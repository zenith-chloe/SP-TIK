-- New feature: track every label print for accountability/debugging, auto-
-- expiring after 30 days. Deliberately does NOT duplicate recipient PII —
-- that already lives on `orders` via order_id; template_data only captures
-- print-specific customization (sku override, custom text, layout choices),
-- not name/phone/address, so this table doesn't become a second place PII
-- could leak from.
create table public.print_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  platform text not null check (platform = ANY (ARRAY['shopee'::text, 'tiktok'::text, 'telegram'::text])),
  template_data jsonb not null default '{}'::jsonb,
  printed_at timestamptz not null default now(),
  expire_at timestamptz not null default (now() + interval '30 days')
);

create index print_history_order_id_idx on public.print_history(order_id);
create index print_history_expire_at_idx on public.print_history(expire_at);

alter table public.print_history enable row level security;

create policy "print_history: read all authenticated" on public.print_history
  for select using (auth.uid() is not null);
create policy "print_history: insert authenticated" on public.print_history
  for insert with check (auth.uid() is not null);
-- No UPDATE/DELETE policy for any client role — print records are
-- append-only from the app's perspective. The only deletion path is the
-- scheduled cleanup job below (runs as the role that owns the cron job,
-- which bypasses RLS the same way other scheduled jobs in this project do).

-- Daily cleanup — deletes only from print_history, never touches orders/
-- order_items/anything else. "expire_at < now()" means rows older than the
-- 30-day window computed at insert time (default now() + interval '30 days').
select cron.schedule(
  'cleanup-expired-print-history',
  '0 3 * * *',
  $$delete from public.print_history where expire_at < now();$$
);
