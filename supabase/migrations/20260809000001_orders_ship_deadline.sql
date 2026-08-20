-- Adds a single nullable column for the real platform shipping deadline
-- (TikTok's rts_time, Shopee's real deadline once confirmed). Additive only
-- — no existing column, constraint, or row is touched. Powers the "Ship
-- Today / Ship Before Tomorrow / Overdue Not Shipped" cards in Order
-- Management Center → 待发货; falls back to the existing order_date-based
-- estimate for any row where this stays null (Shopee, or TikTok rows not
-- yet re-synced).
alter table public.orders add column ship_deadline timestamptz;
