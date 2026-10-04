-- AutoCount Integration framework — ONE genuinely new column, checked
-- against the real schema first (see the audit that preceded this): orders
-- already has autocount_doc_no + autocount_sync_status (pending/synced/
-- failed, default 'pending') and that pair is reused as-is for the
-- NOT_SYNCED/SYNCING/SYNCED/FAILED states this feature needs — pending =
-- not yet synced, synced/failed = self-explanatory, "retry" is just
-- re-attempting from failed, not a stored state. autocount_do_status does
-- NOT exist on orders (only on cancellation_records, a different, unrelated
-- flow) and is not needed here: this ERP's confirmed design is a single DO
-- document per order (no separate Sales Order tracked in ERP), so one
-- status + one doc-no column is sufficient.
--
-- The one thing that has no existing home anywhere is the Automatic Sync
-- ON/OFF setting the AutoCount Integration UI needs (section 9 of the
-- request) — autocount_settings has connection fields only, nothing for
-- this toggle, so a single boolean is added here. Does not touch orders,
-- order_items, products, inventory, or any other table.
alter table public.autocount_settings
  add column auto_sync_enabled boolean not null default false;

comment on column public.autocount_settings.auto_sync_enabled is
  'Whether automatic AutoCount sync is turned on. No cron reads this yet (API not connected) — it only persists the intended setting for when one is wired up.';
