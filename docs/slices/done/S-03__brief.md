status: done
id: S-03
topic: brief.md
title: Onboarding and owner wishlists UI shell
Preconditions (P0s): none

Changes:
- routes/components/config: add `/onboarding` and `/wishlists` screens with stateful UI shell.
- API/schema: none.

Steps:
1. Build two-step onboarding UI with progress indicator.
2. Add required wishlist title field plus optional date/note fields.
3. Add "Try sample items" toggle and dismissible tip placeholder.
4. Add skip action to navigate from onboarding to `/wishlists`.
5. Build owner wishlist list screen with search and sort controls.
6. Add skeleton/empty/loading states for owner list shell.
7. Add copy-share-link interaction scaffold with toast feedback.
8. Add navigation links from owner list to wishlist editor route placeholder.

Design focus:
- Two-step onboarding must feel fast and mobile-first.
- Progress indicator is always visible during onboarding.
- Empty state pushes user toward first wishlist creation.
- Copy-link feedback is immediate and unobtrusive.

Tech focus:
- Keep page components typed and composable.
- UI shell should consume typed placeholder data contracts.
- Search/sort state should be URL-driven where practical.
- No server mutations in this slice.

SQL?:
- none

Env?:
- `CANONICAL_HOST`: host used for share-link format preview.

Acceptance:
- `/onboarding` and `/wishlists` routes render on mobile and desktop.
- Onboarding validates required title before continuing.
- Skip onboarding lands on `/wishlists`.
- Wishlists page shows loading, empty, and populated mock states.
- Copy-link scaffold triggers success toast and clipboard attempt.

Debts:
- Final data wiring moves to next API slice.
