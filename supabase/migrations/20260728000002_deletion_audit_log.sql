-- Prior integrity review found deleteProduct/deleteWarehouseLocation leave no
-- trace at all. A client-side "insert a log row after deleting" is easy to
-- skip (bug, bypassed code path, direct API call), so this enforces it at
-- the DB level instead: a BEFORE DELETE trigger that always fires no matter
-- which client performs the delete, writing a full snapshot of the deleted
-- row. SECURITY DEFINER means the client's own INSERT privileges (it has
-- none on this table) are irrelevant — the trigger function itself does the
-- write, so the audit row can't be skipped or forged by the caller.
create table public.deletion_audit_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type = ANY (ARRAY['products'::text, 'warehouse_locations'::text])),
  entity_id uuid not null,
  entity_label text,
  staff_email text,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.deletion_audit_log enable row level security;

create policy "deletion_audit_log: owner read" on public.deletion_audit_log
  for select using ("current_role"() = 'owner');
-- No INSERT/UPDATE/DELETE policy for any client role on purpose: rows are
-- only ever written by the SECURITY DEFINER trigger function below (which
-- runs as the function owner and bypasses RLS), and are never edited or
-- removed by anyone — an append-only audit trail.

create or replace function public.log_deletion_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.deletion_audit_log (entity_type, entity_id, entity_label, staff_email, detail)
  values (
    TG_TABLE_NAME,
    OLD.id,
    case TG_TABLE_NAME
      when 'products' then OLD.sku
      when 'warehouse_locations' then coalesce(OLD.code, '') || ' ' || coalesce(OLD.name, '')
      else null
    end,
    auth.jwt() ->> 'email',
    row_to_json(OLD)::text
  );
  return OLD;
end;
$$;

create trigger products_deletion_audit
  before delete on public.products
  for each row execute function public.log_deletion_audit();

create trigger warehouse_locations_deletion_audit
  before delete on public.warehouse_locations
  for each row execute function public.log_deletion_audit();
