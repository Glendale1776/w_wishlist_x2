# Changelog

- 2026-02-19 | S-01 | docs/locks/context-S-01-20260219-1419-8a2aeaa.lock.md | Bootstrapped Next.js/TS/Tailwind foundation.
- 2026-02-19 | S-02 | docs/locks/context-S-02-20260219-1434-1b32b0f.lock.md | Re-baselined context lock to current HEAD for S-02 pre-implementation.
- 2026-02-19 | S-02 | docs/locks/context-S-02-20260219-1440-e4601f2.lock.md | Implemented auth routes (/login, /signup, /forgot-password) with returnTo sanitization and client validation.
- 2026-02-19 | S-03 | docs/locks/context-S-03-20260219-1446-f85f633.lock.md | Added onboarding + my wishlists shell with search/sort query state and copy-link toast scaffolding.
- 2026-02-19 | S-04 | docs/locks/context-S-04-20260219-1505-b496d05.lock.md | Added /api/wishlists create/list, UI wiring for onboarding + my wishlists, and migration supabase/migrations/S-04.sql.
- 2026-02-19 | S-05 | docs/locks/context-S-05-20260219-1517-9b1b69a.lock.md | Added item APIs (create/update/archive/metadata), wishlist editor item panel, and migration supabase/migrations/S-05.sql.
- 2026-02-19 | S-06 | docs/locks/context-S-06-20260219-1557-266bb9f.lock.md | Added image upload limits, signed preview retrieval, and editor upload/replace/remove flow.
- 2026-02-19 | S-07 | docs/locks/context-S-07-20260219-1613-0399f2e.lock.md | Added /l/:share_token page, token-hash public read model APIs, and realtime stream with 30s fallback polling.
- 2026-02-19 | S-08 | docs/locks/context-S-08-20260219-1626-3d56617.lock.md | Added public reserve/contribute APIs with idempotency+rate-limit, my activity API/page, and item action modal updates.
- 2026-02-19 | S-09 | docs/locks/context-S-09-20260219-1646-5c55b07.lock.md | Added owner share-link rotation with one-time reveal UX, immediate invalidation, and idempotent retries.
- 2026-02-19 | S-10 | docs/locks/context-S-10-20260219-1700-c2dded6.lock.md | Added admin abuse controls, filtered audit query endpoint, metadata host-redacted failure logging, stream reconnect metrics, and retention cleanup.
