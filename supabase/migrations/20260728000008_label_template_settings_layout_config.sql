-- Additive column for the new 标签设计 (Label Design) UI: size/position
-- presets for image/sku/customText/barcode. Visibility stays owned by the
-- existing enabled_fields text[] (unchanged mechanism, already covers
-- image/sku/customText/note as of prior migrations) — layout_config only
-- adds where/how big, never whether something shows at all, so the two
-- columns can't disagree about visibility.
alter table public.label_template_settings
  add column layout_config jsonb not null default '{}'::jsonb;
