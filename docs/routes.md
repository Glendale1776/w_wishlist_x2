# Routes (brief.md)

## App routes
- `/signup`: create account by email/password.
- `/login`: sign in and restore intended destination.
- `/forgot-password`: request reset email.
- `/onboarding`: first-wishlist setup with optional sample items.
- `/wishlists`: owner dashboard and share-link copy actions.
- `/wishlists/:id`: owner editor for wishlist details and items.
- `/l/:share_token`: public wishlist view without sign-in.
- `/me/activity`: signed-in friend reservation/contribution history.
- `/admin/abuse`: minimal admin controls (disable/re-enable share tokens).

## Owner APIs
- `POST /api/wishlists`: create wishlist + share token hash.
- `GET /api/wishlists`: list owner wishlists with sort/search inputs.
- `GET /api/wishlists/:id`: owner editor view model.
- `PATCH /api/wishlists/:id`: update title/date/note/currency.
- `POST /api/wishlists/:id/rotate-share-link`: rotate token and invalidate previous hash.
- `POST /api/items`: create item.
- `PATCH /api/items/:id`: update item fields.
- `POST /api/items/:id/archive`: archive item.
- `POST /api/items/metadata`: fetch/sanitize URL metadata.
- `POST /api/items/:id/image-upload-url`: issue signed upload URL.

## Public and friend APIs
- `GET /api/public/:share_token/wishlist`: public view model.
- `GET /api/public/:share_token/stream`: realtime updates stream.
- `POST /api/public/:share_token/reservations`: reserve or unreserve current user.
- `POST /api/public/:share_token/contributions`: create contribution pledge.
- `GET /api/me/activity`: list current user activity rows.

## Admin and ops APIs
- `POST /api/admin/share-links/:wishlist_id/disable`: block public token access.
- `POST /api/admin/share-links/:wishlist_id/enable`: restore public token access.
- `GET /api/admin/audit-events`: filtered event query for moderation support.

## Guard rules
- Public wishlist read allows anonymous access with valid token.
- Reserve/contribute requires valid token plus authenticated user.
- Owner routes require ownership check against wishlist `owner_id`.
- Admin routes require admin role claim.
- All mutating public action endpoints require idempotency key.

## Error contract
- Invalid/disabled token returns not-found model for public route.
- Unauthorized returns typed `AUTH_REQUIRED` or `FORBIDDEN`.
- Validation errors return field map with stable error codes.
- Rate-limited actions return retry-after metadata.
- Stream disconnect fallback triggers poll every 30s.
