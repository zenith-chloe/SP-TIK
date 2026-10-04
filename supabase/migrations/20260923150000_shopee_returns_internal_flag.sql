-- Internal-only staff annotation on Shopee Return/Refund rows — a color tag
-- + free-text note for classifying problem returns. Purely additive on the
-- existing shopee_returns table (no new table): nothing here is Shopee
-- data, nothing here is read by shopee-sync-returns, and the trigger below
-- makes it impossible (not just a frontend convention) for a staff update
-- to accidentally touch the real Shopee-sourced columns (return_sn,
-- status, refund_amount, reason, raw, etc.) on this table.
alter table public.shopee_returns
  add column internal_flag_color text check (internal_flag_color in ('red', 'yellow', 'purple')),
  add column internal_note text;

comment on column public.shopee_returns.internal_flag_color is
  'ERP-internal only (not from Shopee): red/yellow/purple/null(cleared) problem tag set by staff.';
comment on column public.shopee_returns.internal_note is
  'ERP-internal only (not from Shopee): free-text note staff attaches to a return, e.g. "what is the issue?".';

create policy "shopee_returns: authenticated update internal flag"
  on public.shopee_returns for update
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Same pattern as restrict_warehouse_product_update() elsewhere in this
-- schema — RLS alone is row-level and can't stop a staff UPDATE from also
-- changing other columns on the same row, so a trigger enforces the
-- column-level boundary. service_role (the sync function) is unrestricted.
create or replace function public.restrict_shopee_returns_internal_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.return_sn is distinct from old.return_sn
    or new.order_no is distinct from old.order_no
    or new.order_id is distinct from old.order_id
    or new.platform_account_id is distinct from old.platform_account_id
    or new.shop_id is distinct from old.shop_id
    or new.status is distinct from old.status
    or new.refund_amount is distinct from old.refund_amount
    or new.reason is distinct from old.reason
    or new.negotiation_status is distinct from old.negotiation_status
    or new.create_time is distinct from old.create_time
    or new.update_time is distinct from old.update_time
    or new.raw is distinct from old.raw
    or new.synced_at is distinct from old.synced_at
  then
    raise exception 'staff updates on shopee_returns may only change internal_flag_color/internal_note';
  end if;
  return new;
end;
$$;

create trigger restrict_shopee_returns_internal_update_trigger
  before update on public.shopee_returns
  for each row execute function public.restrict_shopee_returns_internal_update();
