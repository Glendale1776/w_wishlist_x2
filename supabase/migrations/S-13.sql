-- S-13: track shared wishlist opens per user (idempotent)

create extension if not exists pgcrypto;

create table if not exists public.wishlist_opens (
  id uuid primary key default gen_random_uuid(),
  wishlist_id uuid not null references public.wishlists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  first_opened_at timestamptz not null default now(),
  last_opened_at timestamptz not null default now(),
  open_count integer not null default 1
);

create unique index if not exists wishlist_opens_unique_user_wishlist_idx
  on public.wishlist_opens (wishlist_id, user_id);

create index if not exists wishlist_opens_user_last_opened_idx
  on public.wishlist_opens (user_id, last_opened_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wishlist_opens_open_count_check'
  ) then
    alter table public.wishlist_opens
      add constraint wishlist_opens_open_count_check
      check (open_count >= 1);
  end if;
end $$;
