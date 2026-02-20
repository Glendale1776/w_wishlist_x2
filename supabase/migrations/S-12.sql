-- S-12: items detail columns for persisted descriptions and multi-image support (idempotent)

alter table public.items
  add column if not exists description text null,
  add column if not exists image_urls text[] not null default '{}'::text[];

update public.items
set image_urls = case
  when image_url is null or btrim(image_url) = '' then '{}'::text[]
  else array[image_url]
end
where coalesce(array_length(image_urls, 1), 0) = 0;
