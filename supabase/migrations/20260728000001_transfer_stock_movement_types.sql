-- Warehouse-to-warehouse transfers currently bypass stock_movements entirely
-- (only logged in transfer_logs), so the ledger isn't the single source of
-- truth for every stock change. Widen the movement_type check to allow a
-- paired OUT/IN entry per transfer; existing rows/values are untouched.
alter table public.stock_movements drop constraint stock_movements_movement_type_check;
alter table public.stock_movements add constraint stock_movements_movement_type_check
  check (movement_type = ANY (ARRAY['order_deduction'::text, 'stock_in'::text, 'stock_out'::text, 'adjustment'::text, 'transfer_out'::text, 'transfer_in'::text]));
