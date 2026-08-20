-- Adds a single nullable column for TikTok's real delivery_option_name
-- field (e.g. "Instant", "Next-day delivery", "Standard shipping").
-- Additive only — no existing column, constraint, or row is touched.
-- Confirmed real via live API + a real TikTok Seller Centre order showing
-- "Delivery option: Instant" (order 584451043333343056, 2026-08-09).
alter table public.orders add column delivery_option text;
