-- Standalone, additive table for TikTok Return & Refund data. TikTok tracks
-- returns via a separate API domain from Order Search — the `orders` table
-- has never captured this (confirmed: order_status='returned' has zero real
-- rows, returned_at is null for every TikTok order). This table is the new
-- capture point; it does not touch `orders` at all, so no historical order
-- data, order_status logic, or existing sync path changes.
create table public.tiktok_returns (
  id uuid primary key default gen_random_uuid(),
  platform_account_id uuid references public.platform_accounts(id),
  return_id text not null,
  order_no text not null,
  return_status text,
  create_time timestamptz,
  update_time timestamptz,
  raw jsonb,
  synced_at timestamptz not null default now(),
  unique (platform_account_id, return_id)
);

alter table public.tiktok_returns enable row level security;

create policy "tiktok_returns: insert authenticated"
  on public.tiktok_returns for insert
  with check (auth.uid() is not null);

create policy "tiktok_returns: read all authenticated"
  on public.tiktok_returns for select
  using (auth.uid() is not null);
