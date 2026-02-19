# Acceptance (brief.md)

## Auth and onboarding
- User can sign up with email/password and lands in onboarding.
- User can sign in and is returned to intended route/item action.
- Forgot password sends reset email and shows neutral confirmation.
- Owner can create first wishlist with required title only.

## Owner dashboard and editor
- Owner sees wishlist list with search and newest-first sort.
- Copy share-link action copies absolute URL and shows confirmation toast.
- Owner can add item with title and optional URL/price/image.
- URL metadata autofill populates available fields and keeps manual override.
- Owner can archive items with activity and item disappears from public view.
- Owner cannot hard-delete item with reservations or contributions.

## Public read and surprise mode
- Public route loads by valid share token without sign-in.
- Invalid or disabled token shows not-found state.
- Owner view never reveals reserver names or contributor identities.
- Owner sees only availability status and total funded progress.

## Reserve and contribute
- Signed-out reserve or contribute redirects to auth and returns to same item.
- Signed-in friend can reserve unreserved item and release own reservation.
- Only one active reservation exists per item at any moment.
- Contribution below `1.00` is rejected with field error.
- Contribution updates funded total and progress without page reload.

## Activity, realtime, and ops
- My activity shows only current user reservations/contributions.
- Realtime updates propagate status/progress to second session.
- On stream drop, UI shows disconnect status and polls every 30s.
- Public action endpoints enforce idempotency and per-user/IP rate limits.
- Audit events recorded for create/update/archive/reserve/unreserve/contribute.
- Admin can disable and re-enable share token access.

## File and security constraints
- Image uploads above `10 MB` are rejected client and server side.
- Non-image MIME types are rejected before storage.
- Signed upload and preview URLs expire and are not public by default.
- Service role keys are never referenced in browser bundles.
