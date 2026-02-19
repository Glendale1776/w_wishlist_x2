-- S-05: items table and constraints (idempotent)

create extension if not exists pgcrypto;

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  wishlist_id uuid not null references public.wishlists(id) on delete cascade,
  title text not null,
  url text null,
  price_cents integer null,
  image_url text null,
  is_group_funded boolean not null default false,
  target_cents integer null,
  archived_at timestamptz null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists items_by_wishlist_sort_idx
  on public.items (wishlist_id, archived_at, sort_order);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'items_price_check'
  ) then
    alter table public.items
      add constraint items_price_check
      check (price_cents is null or price_cents >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'items_target_check'
  ) then
    alter table public.items
      add constraint items_target_check
      check (
        (is_group_funded = false and target_cents is null)
        or
        (is_group_funded = true and target_cents is not null and target_cents >= 0)
      );
  end if;
end $$;
