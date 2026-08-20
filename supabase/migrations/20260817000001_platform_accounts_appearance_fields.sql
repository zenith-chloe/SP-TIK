-- ERP-only cosmetic fields for the store list/settings screen: logo, name
-- font color/style, a badge color for quick platform recognition, and a
-- free-text team note. Purely presentational — never read by
-- shopee-sync-orders / tiktok-sync-orders, cron, or any order logic, and
-- does not touch token/shop_id/status/hidden.
alter table public.platform_accounts
  add column logo_url text,
  add column font_color text not null default '#0f172a',
  add column font_style text not null default 'normal' check (font_style in ('normal','bold','italic')),
  add column badge_color text,
  add column shop_note text;
