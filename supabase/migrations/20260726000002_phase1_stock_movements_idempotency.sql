-- Phase 1: enable real stock deduction from platform order sync. This unique constraint
-- is what makes deduction idempotent — each (order_id, sku) pair can only ever produce
-- one stock_movements row, so re-syncing the same order (which happens constantly, since
-- sync re-pulls the last 30 days on every run) never double-deducts stock.

alter table public.stock_movements
  add constraint stock_movements_order_id_sku_key unique (order_id, sku);
