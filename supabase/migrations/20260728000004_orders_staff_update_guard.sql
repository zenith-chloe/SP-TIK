-- The "orders: staff update status" RLS policy only checks auth.uid() IS NOT
-- NULL, so today any logged-in staff account can update ANY column on any
-- order (buyer info, amounts, addresses), not just status/warehouse_stage.
-- RLS policies can't express "only these columns may change" (USING/WITH
-- CHECK see one row version at a time, not an OLD-vs-NEW diff), and column-
-- level GRANT can't tell owner and staff apart since both connect as the
-- same `authenticated` Postgres role — current_role() (app-level owner/staff)
-- only exists inside row/trigger logic. So this is enforced with a trigger.
--
-- Scope, verified against every actual orders UPDATE call site in the app
-- (updateOrderStatus, updateOrderNote, handlePrintConfirm, markPicked,
-- markPacked): they only ever touch order_status, warehouse_stage,
-- print_count, last_printed_at, last_printed_by, note_color, note_text. The
-- allowlist below matches that exactly, so no existing feature is affected.
--
-- auth.role() = 'service_role' covers both sync edge functions (which use
-- SUPABASE_SERVICE_ROLE_KEY and legitimately rewrite buyer/address/amount
-- fields on every sync) and any migration/admin SQL run outside a user
-- session — both are skipped entirely, not just given owner treatment.
create or replace function public.restrict_staff_order_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'authenticated' then
    return new; -- service_role (sync functions), migrations, etc. — not a staff session
  end if;

  if "current_role"() = 'owner' then
    return new;
  end if;

  if new.order_no is distinct from old.order_no
     or new.platform is distinct from old.platform
     or new.platform_account_id is distinct from old.platform_account_id
     or new.buyer_name is distinct from old.buyer_name
     or new.buyer_phone is distinct from old.buyer_phone
     or new.shipping_address is distinct from old.shipping_address
     or new.courier is distinct from old.courier
     or new.tracking_no is distinct from old.tracking_no
     or new.total_amount is distinct from old.total_amount
     or new.shipping_fee is distinct from old.shipping_fee
     or new.order_date is distinct from old.order_date
     or new.is_cod is distinct from old.is_cod
     or new.platform_status is distinct from old.platform_status
     or new.autocount_sync_status is distinct from old.autocount_sync_status
     or new.autocount_doc_no is distinct from old.autocount_doc_no
     or new.telegram_chat_id is distinct from old.telegram_chat_id
     or new.telegram_username is distinct from old.telegram_username
     or new.shipped_at is distinct from old.shipped_at
     or new.returned_at is distinct from old.returned_at
     or new.created_at is distinct from old.created_at
  then
    raise exception 'staff may only update order_status, warehouse_stage, print_count, last_printed_at, last_printed_by, note_color, note_text on orders (blocked column change on order %)', old.order_no;
  end if;

  return new;
end;
$$;

create trigger orders_restrict_staff_update
  before update on public.orders
  for each row execute function public.restrict_staff_order_update();
