A Supabase-backed wishlist system with real-time reservations and contributions that preserve surprise for the owner.

## Decisions
- Use Next.js with TypeScript and Tailwind for the web app.
- Use Supabase for Postgres, Auth, Storage, and Realtime transport. :contentReference[oaicite:1]{index=1}
- Use email and password authentication with password reset.
- Require sign in to reserve or contribute.
- Serve public wishlist pages by share token without requiring sign in.
- Implement live updates to public viewers via a server-managed event stream.
- Store money as integer cents and render using the wishlist currency.
- Default the canonical domain to design.rhcargo.ru.
- Notes are consolidated from the provided project notes. :contentReference[oaicite:2]{index=2}

## Scope boundaries
- Do not process payments for contributions in V1.
- Do not support OAuth providers in V1.
- Do not support multi-owner collaborative editing in V1.
- Do not expose reserver or contributor identity to the owner in V1.

## Data entities
- User represents an authenticated account in Supabase Auth.
- Profile stores display preferences for a user.
- Wishlist represents an occasion list owned by a user.
- Item represents a desired gift entry on a wishlist.
- Reservation represents a user holding an item to prevent duplicates.
- Contribution represents a user pledge toward a group-funded item.
- Audit event records important changes for debugging and abuse handling.

## Suggested tables
- sql: create table profiles (user_id uuid primary key references auth.users(id) on delete cascade, display_name text not null, created_at timestamptz not null default now());
- sql: create table wishlists (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, title text not null, occasion_date date null, occasion_note text null, currency char(3) not null default 'USD', share_token_hash text not null unique, share_token_hint text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
- sql: create table items (id uuid primary key default gen_random_uuid(), wishlist_id uuid not null references wishlists(id) on delete cascade, title text not null, url text null, price_cents integer null, image_url text null, is_group_funded boolean not null default false, target_cents integer null, archived_at timestamptz null, sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
- sql: create table reservations (id uuid primary key default gen_random_uuid(), wishlist_id uuid not null references wishlists(id) on delete cascade, item_id uuid not null references items(id) on delete restrict, user_id uuid not null references auth.users(id) on delete cascade, status text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
- sql: create table contributions (id uuid primary key default gen_random_uuid(), item_id uuid not null references items(id) on delete restrict, user_id uuid not null references auth.users(id) on delete cascade, amount_cents integer not null, created_at timestamptz not null default now());
- sql: create table audit_events (id uuid primary key default gen_random_uuid(), actor_user_id uuid null references auth.users(id) on delete set null, wishlist_id uuid null references wishlists(id) on delete set null, entity_type text not null, entity_id uuid not null, action text not null, after jsonb null, created_at timestamptz not null default now());
- sql: alter table wishlists add constraint wishlists_currency_check check (currency ~ '^[A-Z]{3}$');
- sql: alter table items add constraint items_price_check check (price_cents is null or price_cents >= 0);
- sql: alter table items add constraint items_target_check check ((is_group_funded = false and target_cents is null) or (is_group_funded = true and target_cents is not null and target_cents >= 0));
- sql: alter table contributions add constraint contributions_amount_check check (amount_cents >= 100);
- sql: alter table reservations add constraint reservations_status_check check (status in ('active','released'));
- sql: create unique index reservations_one_active_per_user_item on reservations(item_id, user_id) where status = 'active';
- sql: create index items_by_wishlist_sort on items(wishlist_id, archived_at, sort_order);
- sql: create index contributions_by_item on contributions(item_id, created_at);
- sql: create index reservations_by_item on reservations(item_id, status);

## Derived calculations
- Funded total equals sum of contributions.amount_cents per item.
- Funded progress equals min(funded_total, target_cents) divided by target_cents when target_cents is positive.
- Item availability equals Available when there is no active reservation for the item.
- Item availability equals Reserved when there is at least one active reservation for the item.

## APIs
- POST /api/auth/after-login redirects the user back to the intended wishlist item.
- POST /api/wishlists creates a wishlist and its share token.
- GET /api/wishlists lists wishlists owned by the current user.
- GET /api/wishlists/:id returns wishlist editor data for the owner.
- PATCH /api/wishlists/:id updates wishlist title, occasion fields, and currency.
- POST /api/items creates an item on a wishlist owned by the current user.
- PATCH /api/items/:id updates an item owned by the current user.
- POST /api/items/:id/archive archives an item owned by the current user.
- POST /api/items/metadata fetches and sanitizes metadata for a product URL.
- GET /l/:share_token renders the public wishlist view by token.
- GET /api/public/:share_token/wishlist returns the public wishlist view model by token.
- GET /api/public/:share_token/stream opens a live update stream for the public wishlist.
- POST /api/public/:share_token/reservations creates or releases a reservation for the signed-in user.
- POST /api/public/:share_token/contributions creates a contribution for the signed-in user.
- GET /api/me/activity returns the signed-in user reservation and contribution history.

## Server flows
- Create wishlist generates a random share token and stores only its hash and hint.
- Public wishlist read validates the share token by hashing and matching share_token_hash.
- Reserve item starts a transaction and locks the item row for update.
- Reserve item checks the item is not archived before inserting an active reservation.
- Unreserve item updates the active reservation to released for the current user and item.
- Contribute checks the item is group funded and not archived before inserting a contribution.
- Contribute recalculates funded totals for response using a fresh aggregate query.
- Archive item sets archived_at and keeps reservations and contributions intact.
- Each mutation inserts an audit_events row with the entity id and action.

## Client flows
- Owner signs up and completes onboarding to create the first wishlist.
- Owner adds an item manually or by pasting a URL for autofill.
- Owner copies the public link and shares it externally.
- Public viewer opens the link and sees item status and funding progress.
- Public viewer clicks Reserve or Contribute and is routed to Auth when signed out.
- Signed-in friend completes the action and returns to the item with updated state.
- Live updates refresh item status and progress without a full page reload.

## Validation rules
- Wishlist title is required and must be under a max length.
- Currency is required and must be a 3-letter uppercase code.
- Item title is required and must be under a max length.
- Item URL must be http or https when present.
- Price and target values must be non-negative integers in cents server-side.
- Contribution amount must be at least 100 cents server-side.
- Archive is blocked only by ownership, not by existing activity.
- Public actions require a valid share token and an authenticated user.

## Permissions
- Owners can create, edit, and archive their wishlists and items.
- Friends can view public wishlists by share token without signing in.
- Friends can reserve and contribute only after signing in.
- Friends can see only status and totals and not other user identities.
- Admin can read audit events and disable abusive share tokens.

## Supabase policies
- Restrict wishlists and items selects to the owner in normal client access.
- Restrict reservations and contributions selects to the owning user for activity views.
- Route all public wishlist reads and writes through Next.js handlers by share token.
- Use service role only inside server routes and never in the browser.

## Files and exports
- Store item images in Supabase Storage with per-object owner write access.
- Store public item image URLs as signed URLs where required for privacy.
- Render share links as absolute URLs on design.rhcargo.ru.

## Observability
- Log metadata fetch failures with a request id and sanitized URL host.
- Record audit events for create, update, archive, reserve, unreserve, and contribute actions.
- Track stream connection counts and reconnect rates for live updates.

## Performance and limits
- Paginate item lists after 50 items per wishlist.
- Limit metadata fetch to a short timeout and block private network destinations.
- Rate limit reserve and contribute endpoints per user and per IP.
- Cap uploaded images to 10 MB and compress on upload.

## Test plan
- Create wishlist and confirm share link resolves to the public view.
- Add item manually and confirm it appears in both owner and public views.
- Paste a URL and confirm autofill populates and is editable.
- Reserve an item and confirm status changes live in a second browser session.
- Unreserve an item and confirm status changes live in a second browser session.
- Contribute to a group-funded item and confirm progress updates live.
- Attempt a contribution below 1.00 and confirm the server rejects it.
- Archive an item with activity and confirm it disappears from public view.
- Confirm the owner UI never shows reserver identity or contributor breakdown.
- Confirm a signed-in friend can see only their own reservation and contributions.
- Confirm an invalid share token returns a not found response.

## Slice plan
- Slice 1 delivers auth, onboarding, wishlist creation, and owner list views.
- Slice 2 delivers item CRUD with images and optional URL autofill.
- Slice 3 delivers public wishlist view by share token with read-only items.
- Slice 4 delivers reservations with live updates and conflict-safe writes.
- Slice 5 delivers contributions with progress totals and live updates.
- Slice 6 delivers item archiving, activity history, and audit events.
- Slice 7 delivers hardening for metadata fetch, rate limiting, and error states.

## Assumptions
- Each wishlist has a single currency set by the owner.
- Each item supports at most one active reservation at a time in V1.
- Public view is link-only and not indexed by search engines in V1.
- Email invitations and collaborator roles are not included in V1.
- Guest actions without an account are not included in V1.
- Owners can see item-level Reserved or Available status in Surprise mode.
- Owners can see total funded progress but not per-contributor amounts.

## Open questions (only if non-blocking)
- [P1] Q1 [F] Reservation quantity
  Problem: Quantity per item missing
  Question: Should items support quantity greater than one with partial reservations.
  Default: Keep quantity fixed at one in V1.
- [P1] Q2 [F] Purchased status
  Problem: Purchased marking unclear
  Question: Should friends be able to mark a reserved item as purchased in V1.
  Default: Treat reserved as the only state and omit purchased.
- [P1] Q3 [D] Guest gifting
  Problem: Guest actions conflict
  Question: Should reserve and contribute work without account creation.
  Default: Require sign in for actions and keep viewing public.
