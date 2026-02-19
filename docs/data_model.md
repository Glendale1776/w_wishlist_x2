# Data Model (brief.md)

## Core entities
- `profiles`: user profile metadata keyed by `auth.users.id`.
- `wishlists`: owner-bound list with title, occasion fields, currency, and share token hash.
- `items`: wishlist items with URL, price cents, image URL, group-funded flag, target cents, and archive timestamp.
- `reservations`: signed-in friend hold records with `active|released` status.
- `contributions`: pledge rows in cents tied to group-funded items.
- `audit_events`: immutable mutation trail for abuse/debug workflows.

## Required columns
- `wishlists.share_token_hash` unique, non-null.
- `wishlists.share_token_hint` non-secret short hint for support/debug.
- `items.is_group_funded` boolean default `false`.
- `items.target_cents` required when `is_group_funded=true`.
- `contributions.amount_cents >= 100`.
- `reservations.status in ('active','released')`.

## Relationships
- One user owns many wishlists.
- One wishlist has many items.
- One item has many contributions.
- One item has many reservations over time.
- One item has at most one active reservation at a time.
- Audit event may reference actor user and wishlist.

## Reservation and contribution invariants
- Active reservation blocks other active reservations on the same item.
- Released reservations remain for history and audit.
- Contributions are append-only pledges; no in-place edits.
- Funded total = sum of `contributions.amount_cents` by item.
- Progress ratio = `min(funded_total,target_cents) / target_cents` for `target_cents > 0`.

## SQL and indexes
- Keep owner/list/item foreign keys with cascade/delete rules from technical baseline.
- Add partial unique index: one active reservation per item.
- Keep indexes for item list order, contributions by item/time, reservations by item/status.
- Keep share token hash uniqueness and hash lookup index.

## Policy model
- Owner-only direct reads/writes on private wishlist and item data.
- Public token reads/writes go through Next.js server handlers.
- Friend activity reads limited to actor-owned reservation/contribution rows.
- Admin role can read audit and abuse-token state.

## Retention
- Audit events retained for `180` days by default, then purged by scheduled job.

## Source notes
- NOTE: Resolved reservation uniqueness in favor of `docs/brief.md` one-active-per-item (2026-02-19).
