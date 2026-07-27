-- Fixes a bug found during testing: a SQL CASE expression referencing
-- OLD.code/OLD.name inline inside the INSERT statement gets its field
-- references resolved against OLD's dynamic record type regardless of which
-- CASE branch would actually run, so deleting a `products` row (no `code`
-- column) errored with "record OLD has no field code" before any audit row
-- was written. Real plpgsql IF/ELSIF branches, computed into a variable
-- before the INSERT, only touch the fields valid for that branch.
create or replace function public.log_deletion_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
begin
  if TG_TABLE_NAME = 'products' then
    v_label := OLD.sku;
  elsif TG_TABLE_NAME = 'warehouse_locations' then
    v_label := coalesce(OLD.code, '') || ' ' || coalesce(OLD.name, '');
  else
    v_label := null;
  end if;

  insert into public.deletion_audit_log (entity_type, entity_id, entity_label, staff_email, detail)
  values (TG_TABLE_NAME, OLD.id, v_label, auth.jwt() ->> 'email', row_to_json(OLD)::text);

  return OLD;
end;
$$;
