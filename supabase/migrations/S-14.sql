-- S-14: archived reservation notifications for guests (idempotent)

create extension if not exists pgcrypto;

create table if not exists public.archive_notifications (
  id uuid primary key default gen_random_uuid(),
  wishlist_id uuid not null references public.wishlists(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  archived_item_title text not null,
  archived_item_price_cents integer null,
  suggested_item_ids uuid[] not null default '{}'::uuid[],
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  seen_at timestamptz null,
  emailed_at timestamptz null,
  email_error text null
);

create index if not exists archive_notifications_actor_status_created_idx
  on public.archive_notifications (actor_user_id, status, created_at desc);

create index if not exists archive_notifications_wishlist_created_idx
  on public.archive_notifications (wishlist_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'archive_notifications_status_check'
  ) then
    alter table public.archive_notifications
      add constraint archive_notifications_status_check
      check (status in ('pending', 'seen'));
  end if;
end $$;
