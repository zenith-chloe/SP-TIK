-- Real persisted single-SKU/多规格 intent (2026-08-27, explicit request) —
-- previously only a local UI toggle (multiVariantsOn), never saved, so
-- publish-time code had no reliable way to tell "meant to be single-SKU
-- but has stale leftover variation rows" apart from "genuinely has
-- variations" without asking staff to re-open and re-save the form. Set
-- from the same toggle at save time; used by tiktokPublishProduct to
-- auto-clean stale product_listing_variations rows before the single-SKU
-- validation check.
alter table product_listings
  add column if not exists has_variations boolean not null default false;
