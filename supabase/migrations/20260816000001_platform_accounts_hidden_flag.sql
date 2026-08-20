-- ERP-only display flag for platform_accounts. Does not touch orders,
-- tokens, status, or any sync/cron logic — cron and the sync Edge
-- Functions query platform_accounts independently and never read this
-- column. Default false so every existing row (including shop 227771854)
-- keeps showing exactly as before until the ERP query is updated to
-- filter on it (separate, not-yet-applied change).
alter table public.platform_accounts
  add column hidden boolean not null default false;
