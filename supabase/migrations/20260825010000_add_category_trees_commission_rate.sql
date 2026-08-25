-- 佣金比例提示 (2026-08-25) — staff-entered commission % per internal
-- leaf category, shown as a hint when picking a category so a wrong leaf
-- doesn't silently cause unexpected platform commission. Not a real
-- platform API value (no such integration exists — see file-top note in
-- pagesProductListing.jsx); purely a manually-maintained reference figure.
alter table category_trees
  add column if not exists commission_rate numeric;
