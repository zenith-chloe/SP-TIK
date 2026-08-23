create table if not exists ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('Shopee', 'TikTok Shop')),
  name text not null,
  sku text,
  spend numeric not null default 0,
  clicks integer not null default 0,
  orders integer not null default 0,
  revenue numeric not null default 0,
  status text not null default 'active' check (status in ('active', 'paused')),
  -- Records what staff did in response to the AI advisor's suggestion
  -- (e.g. "已暂停广告", "已降低预算"). This is a manual record of a
  -- decision made, NOT an automated call to any real TikTok/Shopee Ads
  -- API — no such integration exists in this project, so the "一键采纳
  -- AI 优化" button only ever writes to these two columns, it never
  -- changes real ad platform settings.
  ai_action_note text,
  ai_action_taken_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table ad_campaigns enable row level security;

create policy "ad_campaigns: read all authenticated" on ad_campaigns
  for select using (auth.uid() is not null);

create policy "ad_campaigns: owner manage" on ad_campaigns
  for all using ("current_role"() = 'owner') with check ("current_role"() = 'owner');
