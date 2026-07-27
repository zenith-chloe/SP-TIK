-- TikTok full sync resumable pagination progress tracking.
-- Lets tiktok-sync-orders checkpoint its next_page_token after every page,
-- so a run killed by the Edge Function execution limit resumes instead of
-- restarting from page 1 on the next invocation.

create table if not exists public.platform_sync_progress (
  account_id uuid primary key references public.platform_accounts(id) on delete cascade,
  next_page_token text,
  pages_fetched integer not null default 0,
  orders_synced integer not null default 0,
  status text not null default 'in_progress',
  sync_type text not null default 'full',
  last_error text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_sync_progress enable row level security;

create policy "authenticated can read sync progress"
  on public.platform_sync_progress for select
  to authenticated
  using (true);
