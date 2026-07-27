-- Which optional fields print on each label template — managed centrally
-- from the new "标签设置" (Label Settings) tab inside the Label Printing
-- module, instead of being fixed in code. Customer/recipient fields are
-- never included here: they're mandatory and locked, not configurable.

create table if not exists public.label_template_settings (
  template_type text primary key check (template_type in ('shipping', 'picking')),
  enabled_fields text[] not null default '{}'::text[],
  updated_at timestamptz not null default now()
);

alter table public.label_template_settings enable row level security;

create policy "label_template_settings: read all authenticated"
  on public.label_template_settings for select
  to authenticated
  using (true);

create policy "label_template_settings: owner manage"
  on public.label_template_settings for all
  to public
  using ("current_role"() = 'owner')
  with check ("current_role"() = 'owner');

insert into public.label_template_settings (template_type, enabled_fields) values
  ('shipping', array['shipByDate','weight','senderName','senderPhone','senderAddress','postcode','note']),
  ('picking', array['image','sku','productName','qty'])
on conflict (template_type) do nothing;
