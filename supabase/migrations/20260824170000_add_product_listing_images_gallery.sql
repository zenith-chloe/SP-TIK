-- 主图相册 (2026-08-24) — replaces the single image_url URL-paste field
-- with a real multi-image gallery (camera capture + local photo upload,
-- both real Storage uploads, no URL-paste input anymore per explicit
-- request). image_url stays as a read-only "first image" mirror for the
-- existing table/list thumbnails elsewhere in this page that only show one
-- image; image_urls is the real ordered array the new grid UI manages.
alter table product_listings
  add column if not exists image_urls jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "product-images: public read"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "product-images: authenticated upload"
  on storage.objects for insert
  with check (bucket_id = 'product-images' and auth.uid() is not null);

create policy "product-images: authenticated delete own"
  on storage.objects for delete
  using (bucket_id = 'product-images' and auth.uid() is not null);
