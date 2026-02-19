status: done
id: S-07
topic: brief.md
title: Public share view with realtime read model
Preconditions (P0s): none

Changes:
- routes/components/config: add `/l/:share_token` public page with filters and item cards.
- API/schema: add `GET /api/public/:share_token/wishlist` and `GET /api/public/:share_token/stream`.

Steps:
1. Build public wishlist page shell with hero, filters, and item list.
2. Implement share-token validation by hashing incoming token.
3. Return public read model with availability and funding totals only.
4. Hide owner-only controls and all identity fields in public model.
5. Add not-found state for invalid or disabled tokens.
6. Add realtime stream subscription for item status/progress updates.
7. Preserve scroll position while applying live updates.
8. Add stream disconnect UI and 30s polling fallback.

Design focus:
- Public item cards remain readable on mobile widths.
- Availability and progress are visually clear at card level.
- Not-found and disconnected states are explicit and calm.
- Live updates do not jump the viewport.
- Public page excludes owner edit affordances.

Tech focus:
- Token hash lookup avoids exposing stored token artifacts.
- Read model strips reserver/contributor identities.
- Stream payloads are minimal and versioned.
- Poll fallback runs only during stream outage window.
- Public responses include canonical and noindex metadata inputs.

SQL?:
- none

Env?:
- `CANONICAL_HOST`: canonical URL generation.
- `STREAM_HEARTBEAT_SEC`: keepalive interval for stream clients.

Acceptance:
- Valid token renders public list without sign-in.
- Invalid token renders not-found state.
- Public payload contains no identity or per-contributor fields.
- Live updates change status/progress in a second session.
- Scroll position is stable during update application.
- Stream disconnect displays reconnect status.
- Poll fallback refreshes data every 30s while disconnected.

Debts:
- Virtualized lists can be deferred until >50 items.
