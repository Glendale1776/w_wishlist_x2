# UI/UX (brief.md)

## Global behavior
- Mobile-first layouts for all core screens; desktop enhances density only.
- Preserve scroll position on live list updates.
- Use inline field errors plus one toast for server failures.
- Disable submit buttons while pending; show loading labels.
- Keep owner spoiler-safe by hiding reserver/contributor identity everywhere.

## Auth and return flow
- Auth pages show simple email/password form with mode switch.
- Signed-out reserve/contribute sends user to auth with return target.
- Post-login returns to the original item action context.

## Owner setup and management
- Onboarding is two-step with progress indicator and optional sample items.
- My wishlists shows searchable/sortable cards with copy-link action.
- Wishlist editor keeps details and items in one view with clear section labels.
- Item form supports manual entry first, then optional URL autofill.
- Duplicate URL warning is non-blocking and user can still save.

## Item and funding UX
- Item cards show title, optional image, price, availability badge.
- Group-funded cards show target and progress bar with rounded cents display.
- Contribution input accepts decimals and submits integer cents.
- Archive action removes item from public list but preserves actor history.

## Public share UX
- Public route works without registration for read access.
- Reserve/contribute actions open modal and require sign-in.
- Token-not-found state shows safe error with no token diagnostics.
- Public pages use canonical host and noindex metadata.

## Activity and admin UX
- My activity groups reservations/contributions by wishlist.
- Activity list allows quick jump back to the relevant public item.
- Admin abuse view exposes minimal disable/re-enable controls and audit timeline.

## States to cover
- Empty owner state: no wishlists yet.
- Empty item state: no items in wishlist.
- Empty public state: no active items visible.
- Loading skeletons for list and card fetches.
- Disconnected realtime banner with automatic 30s retry polling.
