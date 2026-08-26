-- Per-variant weight unit toggle (2026-08-26) — mirrors the existing
-- product_listings.weight_unit column exactly: weight_kg always stores the
-- real converted kilogram value (conversion happens client-side on save,
-- same as the top-level weight field already does), weight_unit is purely
-- a display preference so a row that was typed in grams shows grams again
-- next time it's opened for editing, instead of always resetting to kg.
alter table product_listing_variations add column if not exists weight_unit text default 'kg' check (weight_unit in ('kg', 'g'));
