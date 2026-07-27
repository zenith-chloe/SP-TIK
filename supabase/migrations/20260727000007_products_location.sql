-- Per-SKU warehouse bin/shelf location, shown/edited in the Inventory page
-- alongside the new live-computed reserved/available stock columns.

alter table public.products add column location text;
