A web app for creating shareable wishlists so friends can reserve and contribute without duplicates or spoilers.

## Context
- Wishlists are created for occasions like birthdays and holidays.
- Each wishlist is shared via a hard-to-guess public link.
- Friends coordinate by reserving items and contributing to group-funded items.
- Purchases happen on external retailer sites.
- Surprise mode prevents revealing reserver and contributor identities.
- Reservations and contributions update for all viewers in real time.
- Notes are consolidated from the provided project notes. :contentReference[oaicite:0]{index=0}

## Outcomes
- Owners create a wishlist and add items in minutes.
- Owners share one public link that opens without registration for viewing.
- Friends see item availability and group-funding progress immediately.
- Friends reserve items to prevent duplicate gifting.
- Friends contribute pledges to group-funded items without in-app payments.
- Owners see per-item Reserved or Available status without identities.
- Owners see funded progress as a total against a target without contributor breakdown.
- Everyone viewing the list sees updates without refreshing the page.

## Scope
- Create an account with email and password.
- Create, rename, and edit wishlists with occasion metadata.
- Add, edit, and remove items with title, URL, price, and image.
- Paste a URL to autofill item title, image, and price when available.
- Mark an item as group-funded with a target amount.
- View a wishlist via a public share link without signing in.
- Reserve and unreserve an item after signing in.
- Contribute a pledge amount to a group-funded item after signing in.
- View your own reservation and contribution history for a wishlist.
- Archive an item that has reservations or contributions.

## Surprise mode rules
- Owners never see who reserved an item.
- Owners never see contributor identities or per-contributor amounts.
- Owners see only item availability status and total funding progress.

## Reservation rules
- An item is Available when it has reservable quantity remaining.
- An item is Reserved when no reservable quantity remains.
- Reservations update visibility for all viewers immediately.

## Contribution rules
- Contributions are pledges and do not process payments.
- Minimum contribution is 1.00 in the wishlist currency.
- Contribution amounts are stored as integer cents.
- Funding progress is the sum of contributions against the current target.
- If the target is not reached, the item remains open until the owner archives it.

## Item lifecycle rules
- Items with any reservations or contributions cannot be hard-deleted.
- Archiving removes an item from the public view.
- Archived items remain visible to contributors for their own pledge history.
- Changing item price or target recalculates progress against the new target.

## Share link rules
- The public link uses a random token and is not guessable.
- The public link is viewable without registration.

## Permissions
- Owner can create, edit, and share their wishlists.
- Owner can archive items but cannot hard-delete items with activity.
- Friend can view a wishlist via the public link.
- Friend can reserve and contribute only after signing in.
- Admin can access minimal tooling for abuse handling.

## Out of scope
- In-app payments, refunds, or checkout.
- OAuth login providers.
- Multi-owner collaborative editing.
- Native mobile apps.
- Public search indexing and directories.
