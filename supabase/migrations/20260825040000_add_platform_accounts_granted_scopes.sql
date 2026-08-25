-- Update Connection 校验: 记录 OAuth 授权范围 (2026-08-25) — captured from
-- TikTok's token/get and token/refresh responses (data.granted_scopes),
-- so a reauth's scope change is actually verifiable in the DB, not just
-- assumed. Stored as jsonb array of scope strings.
alter table platform_accounts
  add column if not exists granted_scopes jsonb;
