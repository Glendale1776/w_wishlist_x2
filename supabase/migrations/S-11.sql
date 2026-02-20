-- S-11: wishlist share-link state columns (idempotent)

alter table public.wishlists
  add column if not exists share_token_disabled_at timestamptz null,
  add column if not exists share_token_rotated_at timestamptz null;

create index if not exists wishlists_share_token_hint_idx
  on public.wishlists (share_token_hint);
