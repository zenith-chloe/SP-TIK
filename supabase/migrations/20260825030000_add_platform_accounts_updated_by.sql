-- 连接管理: 更新连接/退出连接 (2026-08-25) — who last changed this
-- connection's auth state (reauthorized or disconnected it). Not settable
-- during the unauthenticated OAuth callback unless the initiating browser
-- tab passed its user identity through the OAuth `state` param (see
-- tiktok-auth-start/tiktok-auth-callback) — null there means no identity
-- was passed (e.g. very first connect before this feature existed).
-- last_authorized_at / token_expiry_at already exist as auth_time /
-- token_expires_at respectively; not duplicating those columns.
alter table platform_accounts
  add column if not exists updated_by text;
