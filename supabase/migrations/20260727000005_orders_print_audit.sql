-- Print audit trail for the shipping-label workflow: when an order was last
-- printed and by whom (email, matching how buyer_name/courier etc. are
-- already stored as plain readable text rather than normalized FKs in this
-- schema). print_count already tracks how many times; these two add when
-- and who for the reprint-warning banner and any future audit needs.

alter table public.orders add column last_printed_at timestamptz;
alter table public.orders add column last_printed_by text;
