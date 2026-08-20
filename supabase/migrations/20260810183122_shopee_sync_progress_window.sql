-- Adds the sync-window checkpoint fields needed for Shopee's resumable
-- batched sync (approved plan, 2026-08-10). Additive only — no existing
-- column, constraint, or row on platform_sync_progress is touched, and
-- this table is not used by any TikTok logic path change; TikTok's own
-- rows continue exactly as before, isolated by account_id.
--
-- Without these, a resumed sync would recompute time_from/time_to as
-- "now" on every invocation, silently drifting the 15-day window across
-- a multi-invocation Shopee sync. Storing the window once per pass (set
-- when a fresh pass starts, read back unchanged on every resume until the
-- pass completes) keeps the window fixed for the whole pass.
alter table public.platform_sync_progress
  add column sync_window_from bigint,
  add column sync_window_to bigint;
