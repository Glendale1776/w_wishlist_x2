status: done
id: S-08
topic: brief.md
title: Action connector for reserve, contribute, activity
Preconditions (P0s): none

Changes:
- routes/components/config: add item action modal wiring and `/me/activity` history screen.
- API/schema: add `POST /api/public/:share_token/reservations`, `POST /api/public/:share_token/contributions`, `GET /api/me/activity`; add reservation/contribution constraints and audit events.

Steps:
1. Build item action modal with reserve, unreserve, and contribute controls.
2. Add signed-out redirect to auth and return-to-item restoration.
3. Implement reservation endpoint with transactional item lock and archive check.
4. Enforce one active reservation per item across all users.
5. Implement contribution endpoint with min amount and group-funded checks.
6. Add idempotency key handling for public mutation endpoints.
7. Add rate limiting by user and IP for reserve/contribute endpoints.
8. Emit audit event records for reserve, unreserve, and contribute actions.
9. Build `/me/activity` list for current user reservations/contributions only.
10. Update public card state immediately after successful modal actions.

Design focus:
- Modal keeps reservation and contribution sections clearly separated.
- Signed-out flow preserves user context and reduces friction.
- Success and error messaging stays concise and actionable.
- Activity screen makes return-to-item navigation obvious.

Tech focus:
- Server-side auth required for reserve/contribute and activity read.
- Reservation mutation uses transaction and conflict-safe constraints.
- Contribution amount normalized to cents before persistence.
- Idempotency cache prevents duplicate writes from retries.
- Rate-limit responses include stable error code and retry hint.
- Audit payload excludes sensitive fields and keeps actor id.

SQL?:
- `reservations` status check and partial unique index for one active reservation per item.
- `contributions` minimum amount check (`>=100` cents).
- `audit_events` insert path for reservation/contribution mutations.

Env?:
- `RATE_LIMIT_ACTIONS_PER_MIN`: reserve/contribute rate cap.
- `IDEMPOTENCY_TTL_SEC`: mutation dedupe window.

Acceptance:
- Signed-out reserve/contribute redirects to auth and returns to item.
- Reserve action blocks concurrent second reservation for same item.
- Unreserve releases only current user active reservation.
- Contribution below `1.00` is rejected with field-level message.
- Successful contribution updates funded total and progress.
- Duplicate mutation retry with same idempotency key is no-op.
- Rate-limited requests return retry metadata.
- Activity page lists only current user rows.
- Reservation/contribution actions create audit events.

Debts:
- Purchased-state workflow intentionally excluded from V1.
