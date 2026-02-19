-- S-08: reservations, contributions, and activity audit schema (idempotent)

create extension if not exists pgcrypto;

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  wishlist_id uuid not null references public.wishlists(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reservations_item_status_idx
  on public.reservations (item_id, status);

create index if not exists reservations_user_updated_idx
  on public.reservations (user_id, updated_at desc);

create unique index if not exists reservations_one_active_item_idx
  on public.reservations (item_id)
  where status = 'active';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservations_status_check'
  ) then
    alter table public.reservations
      add constraint reservations_status_check
      check (status in ('active', 'released'));
  end if;
end $$;

create table if not exists public.contributions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_cents integer not null,
  created_at timestamptz not null default now()
);

create index if not exists contributions_item_created_idx
  on public.contributions (item_id, created_at desc);

create index if not exists contributions_user_created_idx
  on public.contributions (user_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'contributions_amount_check'
  ) then
    alter table public.contributions
      add constraint contributions_amount_check
      check (amount_cents >= 100);
  end if;
end $$;

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid null references auth.users(id) on delete set null,
  wishlist_id uuid null references public.wishlists(id) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  after jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_wishlist_created_idx
  on public.audit_events (wishlist_id, created_at desc);

create index if not exists audit_events_actor_created_idx
  on public.audit_events (actor_user_id, created_at desc);
