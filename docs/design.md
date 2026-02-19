A polished, mobile-first wishlist UI where viewers can coordinate in real time without revealing spoilers to the owner.

## Entry points
- Owners start at /signup or /login.
- Owners land in onboarding after first login.
- Public viewers start at /l/:share_token.

## Screen map
- Auth: Sign up and sign in for owners and friends.
- Onboarding: Create first wishlist and first item with sample option.
- My wishlists: View and create wishlists and copy share links.
- Wishlist editor: Manage wishlist details and items and share link.
- Public wishlist: View items, availability, and funding progress.
- Item action modal: Reserve, unreserve, and contribute with return-to-item flow.
- My activity: View your reservations and contributions for a wishlist.

## Auth layout
- Show a centered form card with email and password fields.
- Show a secondary link to switch between sign in and sign up.
- Show a lightweight notice about returning to the item after sign in.

## Auth fields
- Email is required and must be a valid email format.
- Password is required and must meet minimum length rules.

## Auth actions
- Sign up creates an account and logs the user in.
- Sign in authenticates and returns the user to the prior destination.
- Forgot password sends a reset email to the entered address.

## Auth behaviors
- Preserve the intended destination in the URL or session state.
- Autofocus the email field on first load.

## Onboarding layout
- Show a two-step flow with progress indicator.
- Show an empty-state preview of a wishlist with example items.

## Onboarding fields
- Wishlist title is required and has a max length.
- Occasion date is optional and uses a date picker.
- Occasion note is optional and has a max length.

## Onboarding actions
- Create wishlist completes step one and opens item creation.
- Try with sample items creates a wishlist with removable example items.
- Skip onboarding opens My wishlists.

## Onboarding behaviors
- After creation, open the Wishlist editor focused on the Items section.
- If sample items were created, show a dismissible tip about deleting them.

## My wishlists layout
- Show a list of wishlist cards with title and occasion date.
- Show a primary button to create a new wishlist.
- Show a quick share control per wishlist card.

## My wishlists fields
- Search filters wishlists by title.
- Sort orders wishlists by most recently updated.

## My wishlists actions
- Create wishlist opens the onboarding flow or a quick-create dialog.
- Open wishlist navigates to the Wishlist editor.
- Copy share link copies the public URL to clipboard.

## My wishlists behaviors
- Show a toast confirming the share link copy.
- Disable actions and show skeletons while loading.

## Wishlist editor layout
- Show a header with wishlist title and share link button.
- Show two main sections for Wishlist details and Items.
- Show an item list with an Add item control.

## Wishlist editor fields
- Wishlist title is required and has a max length.
- Occasion date is optional and stored in the wishlist timezone.
- Welcome message is optional and has a max length.

## Wishlist editor actions
- Add item opens a drawer or modal for item creation.
- Edit item opens the item editor with current values.
- Archive item archives the item and removes it from the public view.
- Copy share link copies the public URL for the wishlist.

## Wishlist editor behaviors
- Reflect item availability and funding progress without showing identities.
- Prevent hard-delete controls when an item has any activity.
- Reorder items by drag and drop if manual ordering is enabled.

## Wishlist editor layout
- Show the item form as a focused panel with preview.
- Show image preview with replace and remove options.

## Wishlist editor fields
- Item title is required and has a max length.
- Item URL is optional and must be http or https when present.
- Item price is optional and is entered as a decimal in the wishlist currency.
- Item image is optional and accepts common image types.
- Group funded toggle enables a target amount field.
- Target amount defaults to the item price when group funded is enabled.

## Wishlist editor actions
- Save item persists the item and returns to the item list.
- Cancel returns to the item list without saving.
- Autofill from URL fetches metadata and fills available fields.

## Wishlist editor behaviors
- If URL autofill fails, keep the URL and show manual entry fields.
- Warn on duplicate URLs within the same wishlist and allow saving.

## Public wishlist layout
- Show a hero section with wishlist title and occasion date.
- Show an item list with cards optimized for mobile.
- Show each item with availability status and funding progress if enabled.

## Public wishlist fields
- Search filters items by title.
- Filter chips include availability and group-funded when present.

## Public wishlist actions
- Reserve opens the Item action modal and requires sign in.
- Contribute opens the Item action modal and requires sign in.
- Refresh retries loading when an error occurs.

## Public wishlist behaviors
- Subscribe to live updates so statuses change without refresh.
- Keep the user on the same scroll position during live updates.
- Hide owner-only controls in public view.

## Item action modal layout
- Show item title, image, and current status.
- Show reservation controls and contribution controls as separate sections.

## Item action modal fields
- Contribution amount is required for contributing and must be at least 1.00.
- Contribution amount is entered in the wishlist currency and stored as cents.

## Item action modal actions
- Reserve creates a reservation and closes the modal on success.
- Unreserve releases the user reservation and closes the modal on success.
- Contribute records a pledge and closes the modal on success.

## Item action modal behaviors
- If the user is not signed in, redirect to Auth and return to this item.
- Show a success toast and update the item card state immediately.

## My activity layout
- Show a grouped list of reservations and contributions by wishlist.
- Show quick links back to each public wishlist.

## My activity fields
- Filter by status limits rows to active reservations and contributions.
- Search filters by wishlist title and item title.

## My activity actions
- Open item navigates to the public wishlist and focuses the item.
- Unreserve releases an active reservation from this screen.

## My activity behaviors
- Update activity list when live updates change reservation state.
- Show empty state when the user has no activity yet.

## Validation feedback
- Show inline errors under the field that is invalid.
- Show a single toast for server errors with a retry suggestion.
- Block submit buttons while saving and show a loading label.

## Empty, loading, and error states
- Show an onboarding empty state when the owner has no wishlists.
- Show an empty item state with an Add item button in the editor.
- Show a public list empty state when a wishlist has no items.
- Show a not found state when a share token is invalid or revoked.
- Show a disconnected state when live updates are unavailable.

## Permission states
- Owners see editor actions and cannot see reserver or contributor identities.
- Public viewers see read-only item cards until they sign in.
- Signed-in friends see Reserve and Contribute actions in public view.
- Admin-only controls are not shown in V1 UI.

## Copy and formatting
- Prices display with a currency symbol and two decimals.
- Contribution inputs accept decimals and round to cents on submit.
- Public share URLs use https://design.rhcargo.ru/l/:share_token.
