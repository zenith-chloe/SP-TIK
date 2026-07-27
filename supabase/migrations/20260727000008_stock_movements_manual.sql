-- Manual stock-in / stock-out / adjustment support, extending the existing
-- stock_movements ledger rather than creating a parallel table. Existing
-- order-triggered rows (from print/pack deduction and platform sync) are
-- unaffected: movement_type defaults to 'order_deduction' so they keep
-- their current meaning with no backfill needed. order_id/platform were
-- already nullable, so manual movements (no order) fit without further
-- schema changes there.
--
-- `warehouse` records which physical warehouse (A/B, matching products.
-- warehouse_a_qty/warehouse_b_qty) a movement affects — included now so the
-- ledger doesn't need reshaping if a third warehouse is added later; the
-- products table itself still only has two warehouse columns today, that's
-- unchanged.

alter table public.stock_movements add column movement_type text not null default 'order_deduction'
  check (movement_type in ('order_deduction', 'stock_in', 'stock_out', 'adjustment'));

alter table public.stock_movements add column qty_change integer; -- signed delta; null on legacy order_deduction rows
alter table public.stock_movements add column reason text;
alter table public.stock_movements add column staff_email text;
alter table public.stock_movements add column warehouse text check (warehouse is null or warehouse in ('A', 'B'));
