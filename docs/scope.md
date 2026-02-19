# Scope (brief.md)

## Outcome
- Ship a mobile-first wishlist flow where owners share one link and friends coordinate gifts without duplicate buys or spoiler leaks.

## In scope
- Email/password auth with reset and return-to-item after sign-in.
- Owner onboarding, wishlist creation, owner list view, and share-link copy.
- Item CRUD with optional URL metadata autofill and optional image upload.
- Group-funded items with target amount and pledge-only contributions.
- Public token route for read access without sign-in.
- Signed-in friend actions: reserve, unreserve, contribute.
- Realtime status/progress updates plus stream-fallback polling.
- Owner surprise mode: status/totals visible, identities hidden.
- Item archive instead of hard delete when activity exists.
- Personal activity history for each signed-in friend.
- Minimal admin abuse controls for share-token disable/re-enable.

## Out of scope
- In-app payment collection, refunds, or checkout.
- OAuth providers and social login.
- Multi-owner collaborative editing.
- Native mobile apps.
- Public indexing and directory discovery.

## Global constraints
- Stack: Next.js + TypeScript + Tailwind + Supabase.
- Canonical host: `design.rhcargo.ru`; locale default `en-US`.
- Money stored as integer cents; minimum contribution `100`.
- Public access by strong random share token; store only token hash.
- One active reservation allowed per item in V1.
- Upload limit `10 MB`; validate type before storage.
- Server routes enforce auth/ownership; service role never in browser.
- Typed API errors; token failures return not-found state.

## Priority order
- P0: Auth, owner setup, item management, public read, reserve/contribute, surprise mode.
- P1: Token rotation UX, stream fallback polish, admin abuse tooling depth.

## Source notes
- NOTE: Technical baseline implied active reservation uniqueness per `(item_id,user_id)`; resolved in favor of `docs/brief.md` one-active-per-item rule (2026-02-19).
