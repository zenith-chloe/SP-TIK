-- Standalone, additive table for Shopee Return & Refund data — mirrors the
-- existing tiktok_returns table's shape/RLS pattern (20260805000001) so both
-- platforms' return data lives in a consistent, separately-owned table. The
-- `orders` table only ever gets a coarse order_status='returned' signal
-- (from mapShopeeOrderStatus's TO_RETURN case) or a manual staff click —
-- neither carries refund_amount/reason/negotiation_status, and this table
-- does not touch `orders`/`order_items`/`products`/`inventory` at all: no
-- historical data, no existing sync path, no schema on those tables changes.
create table public.shopee_returns (
  id uuid primary key default gen_random_uuid(),
  platform_account_id uuid references public.platform_accounts(id),
  shop_id text,
  return_sn text not null,
  order_no text not null,
  order_id uuid references public.orders(id),
  status text,
  refund_amount numeric,
  reason text,
  negotiation_status text,
  create_time timestamptz,
  update_time timestamptz,
  raw jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform_account_id, return_sn)
);

create index idx_shopee_returns_update_time
  on public.shopee_returns (update_time desc)
  where update_time is not null;

create index idx_shopee_returns_status
  on public.shopee_returns (status)
  where status is not null;

create index idx_shopee_returns_order_no
  on public.shopee_returns (order_no);

alter table public.shopee_returns enable row level security;

create policy "shopee_returns: insert authenticated"
  on public.shopee_returns for insert
  with check (auth.uid() is not null);

create policy "shopee_returns: read all authenticated"
  on public.shopee_returns for select
  using (auth.uid() is not null);

comment on table public.shopee_returns is
  'Shopee Return & Refund data (get_return_list/get_return_detail), synced separately from orders. status/negotiation_status keep Shopee''s real values untranslated.';

comment on column public.shopee_returns.update_time is
  'Last update timestamp from Shopee, used for incremental sync filtering';
