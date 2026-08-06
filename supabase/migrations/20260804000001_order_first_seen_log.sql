-- Diagnostic-only table: records, for each order the sync ever encounters,
-- the TikTok create_time vs. the moment our sync first saw/wrote it, so the
-- real-world "TikTok Open API indexing delay" can be measured over a sample
-- of new orders. Never read or written by any existing sync logic — purely
-- additive telemetry, one INSERT ... ON CONFLICT DO NOTHING per order per
-- lifetime (first sighting only, never updated again).
create table public.order_first_seen_log (
  order_no text primary key,
  platform text not null,
  tiktok_created_at timestamptz not null,
  api_found_at timestamptz not null default now(),
  erp_insert_at timestamptz not null default now()
);

alter table public.order_first_seen_log enable row level security;

create policy "order_first_seen_log: insert authenticated"
  on public.order_first_seen_log for insert
  with check (auth.uid() is not null);

create policy "order_first_seen_log: read all authenticated"
  on public.order_first_seen_log for select
  using (auth.uid() is not null);
