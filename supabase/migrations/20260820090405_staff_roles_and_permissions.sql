-- 员工帐号管理 + 角色权限设定 (方案 A, 2026-08-20, approved)
-- Widen profiles.role to the 5 fixed roles the owner asked for, additive to
-- the existing 3 values (owner/staff/warehouse untouched, nothing
-- reassigned). 'warehouse' is reused as-is (already meant 仓管); 'admin',
-- 'purchasing', 'finance', 'customer_service' are new.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner','staff','warehouse','admin','purchasing','finance','customer_service'));

-- Role x module permission matrix — Plan A scope: real, persisted, editable
-- by the owner, but purely a *record of intent* for now. Does NOT gate any
-- other table's RLS yet (every other table keeps its existing
-- current_role()='owner' checks unchanged) — wiring real enforcement is a
-- separate, larger future phase (Plan B), not done here.
create table if not exists public.role_permissions (
  role text not null check (role in ('admin','purchasing','warehouse','finance','customer_service')),
  module text not null check (module in ('订单','库存','财务','AI','权限')),
  allowed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (role, module)
);

alter table public.role_permissions enable row level security;

create policy "role_permissions: authenticated read" on public.role_permissions
  for select using (auth.role() = 'authenticated');
create policy "role_permissions: owner manage" on public.role_permissions
  for all using ("current_role"() = 'owner') with check ("current_role"() = 'owner');

-- Seed from the exact matrix the placeholder UI already showed (src/shared.jsx
-- ROLES constant), so the real page doesn't visually regress on first load.
insert into public.role_permissions (role, module, allowed) values
  ('admin','订单',true), ('admin','库存',true), ('admin','财务',true), ('admin','AI',true), ('admin','权限',true),
  ('purchasing','订单',true), ('purchasing','库存',true), ('purchasing','财务',false), ('purchasing','AI',true), ('purchasing','权限',false),
  ('warehouse','订单',true), ('warehouse','库存',true), ('warehouse','财务',false), ('warehouse','AI',false), ('warehouse','权限',false),
  ('finance','订单',false), ('finance','库存',false), ('finance','财务',true), ('finance','AI',false), ('finance','权限',false),
  ('customer_service','订单',true), ('customer_service','库存',false), ('customer_service','财务',false), ('customer_service','AI',true), ('customer_service','权限',false)
on conflict (role, module) do nothing;
