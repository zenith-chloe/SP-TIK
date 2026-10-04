-- UI changed the internal problem-tag palette from red/yellow/purple to
-- red/green/blue (still the same reused column, no new column, no new
-- table). One real row already carries a real staff-entered value
-- (internal_flag_color='yellow', a genuine note, not test data) — widening
-- the constraint to the union of old+new values instead of dropping
-- yellow/purple, so that real existing row is never silently lost. The
-- new UI only ever writes red/green/blue/null going forward.
alter table public.shopee_returns
  drop constraint shopee_returns_internal_flag_color_check;

alter table public.shopee_returns
  add constraint shopee_returns_internal_flag_color_check
  check (internal_flag_color in ('red', 'green', 'blue', 'yellow', 'purple'));
