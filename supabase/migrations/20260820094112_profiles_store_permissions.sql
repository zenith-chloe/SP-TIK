-- 店铺权限授权 (2026-08-20) — which platform_accounts a non-owner staff
-- member can access. Array column on profiles (simplest of the two options
-- offered), references platform_accounts.id conceptually — not a hard FK
-- (Postgres doesn't support array FKs directly), values are only ever
-- written by admin-manage-staff after validating against real
-- platform_accounts rows. Empty array = no stores assigned yet.
-- Additive only, no other column/table touched.
alter table public.profiles add column if not exists store_ids uuid[] not null default '{}'::uuid[];
