status: pending
id: S-04
topic: brief.md
title: Wishlist create/list APIs and schema bootstrap
Preconditions (P0s): none

Changes:
- routes/components/config: connect onboarding + `/wishlists` to owner create/list APIs.
- API/schema: add `POST /api/wishlists`, `GET /api/wishlists`; create `profiles` and `wishlists` baseline tables.

Steps:
1. Create idempotent migration for `profiles` and `wishlists` tables.
2. Add unique `share_token_hash` and currency validation constraints.
3. Implement `POST /api/wishlists` with owner auth and input validation.
4. Generate random share token; persist only hash and hint.
5. Implement `GET /api/wishlists` owner-scoped list with sorting.
6. Return typed API errors for auth and validation failures.
7. Wire onboarding submit to create wishlist API.
8. Wire `/wishlists` data fetch to owner list API.
9. Wire copy-share-link UI to returned canonical URL format.

Design focus:
- Onboarding submit and list refresh feel immediate.
- Validation errors stay inline and actionable.
- Copy-share interaction confirms success clearly.

Tech focus:
- Owner auth checks enforced in both endpoints.
- Never store or log plaintext share token.
- API response contracts are stable and typed.
- Migration is safe to rerun and non-destructive.
- Currency defaults to USD and enforces 3-letter uppercase format.

SQL?:
- `profiles` table with `user_id` FK to `auth.users`.
- `wishlists` table with owner FK, currency check, unique `share_token_hash`.

Env?:
- `CANONICAL_HOST`: absolute host used in share URLs.

Acceptance:
- Authenticated owner can create wishlist from onboarding.
- Unauthenticated create/list requests are rejected.
- Created wishlist appears on `/wishlists` without manual refresh.
- Share token plaintext is returned once and not stored.
- DB enforces share token uniqueness and currency format.

Debts:
- Invite/collaborator features remain out of scope.
