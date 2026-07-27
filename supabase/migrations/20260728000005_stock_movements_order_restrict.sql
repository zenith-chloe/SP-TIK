-- stock_movements.order_id currently ON DELETE SET NULL: deleting an order
-- silently strips the ledger's link back to it, breaking traceability for
-- exactly the rows meant to prove where stock went. Switch to RESTRICT so an
-- order with any recorded stock movement simply cannot be deleted at all
-- until those movements are dealt with. No existing data is affected — 0
-- rows currently have order_id nulled by this cascade, and NULL remains
-- valid for manual movements which never set order_id in the first place.
alter table public.stock_movements drop constraint stock_movements_order_id_fkey;
alter table public.stock_movements add constraint stock_movements_order_id_fkey
  foreign key (order_id) references public.orders(id) on delete restrict;
