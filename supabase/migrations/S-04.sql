-- S-04: profiles + wishlists schema bootstrap (idempotent)

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Wishlist Owner',
  created_at timestamptz not null default now()
);

create table if not exists public.wishlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  occasion_date date null,
  occasion_note text null,
  currency char(3) not null default 'USD',
  share_token_hash text not null,
  share_token_hint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists wishlists_share_token_hash_key
  on public.wishlists (share_token_hash);

create index if not exists wishlists_owner_updated_idx
  on public.wishlists (owner_id, updated_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'wishlists_currency_check'
  ) then
    alter table public.wishlists
      add constraint wishlists_currency_check
      check (currency ~ '^[A-Z]{3}$');
  end if;
end $$;
