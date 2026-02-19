1) Build a mobile-first wishlist app where owners share one link and friends reserve or pledge in real time without spoiler leaks.

2) People + pains
- People: wishlist owner; gift-giving friend.
- Pain 1: Owners need setup and sharing in minutes.
- Pain 2: Friends need live availability to avoid duplicate gifts.
- Pain 3: Both sides need spoiler-safe coordination with no identity leaks.

3) Top tasks
- Create account, create wishlist, and copy one public share link.
- Add, edit, and archive items, including URL autofill and optional group-funded target.
- Open public wishlist by token, then reserve or unreserve an item after sign-in.
- Add a pledge to group-funded items and see progress update live.
- Review personal reservation and contribution history for a wishlist.

4) Data per task (persisted only)
- Create wishlist: user_id, wishlist_id, title, occasion_date, occasion_note, currency, share_token_hash.
- Manage items: item_id, wishlist_id, title, url, price_cents, image_url, is_group_funded, target_cents, archived_at, sort_order.
- Reserve or unreserve: reservation_id, item_id, user_id, status, created_at, updated_at.
- Contribute pledge: contribution_id, item_id, user_id, amount_cents, created_at.
- Activity and abuse trace: actor_user_id, wishlist_id, entity_type, entity_id, action, after, created_at.

5) Screens
- Auth: sign up/sign in and return-to-item flow; email, password, mode switch, reset password, destination restore.
- Onboarding: create first wishlist fast; title, optional date, optional note, sample-items option, step progress.
- My wishlists: manage owned lists; search, sort, create button, wishlist cards, copy-share action.
- Wishlist editor: maintain wishlist and items; title/date/message, item list, add/edit item panel, archive action, share-link copy.
- Public wishlist: spoiler-safe shared view; hero, filters, item cards, availability badge, funding progress, reserve/contribute entry.
- My activity: user-only history; grouped reservations/contributions, status filter, search, open-item link.
- Abuse tools (Admin): minimal moderation controls; disable share token, inspect audit events, re-enable token (Admin).

6) Must-haves vs Later
- Must-haves: email auth, public token view, item CRUD, URL autofill fallback, reserve/unreserve, pledges without payments, live updates, archive-with-activity, my activity, strict surprise mode.
- Later: OAuth providers, in-app checkout/refunds, multi-owner editing, native mobile apps, public search/directory, purchased state.

Flags: Supabase yes; AdminArticles no; SEO basic.

Overrides:
- Product: canonical `design.rhcargo.ru`; locale `en-US`; auth = email/password + reset; uploads = Supabase Storage images (10 MB max); SEO basics = canonical tags + noindex on public list pages.
- Design & UX: mobile-first list and modal flows; preserve scroll during live updates; inline validation and one retry toast for server failures.
- Tech & Ops: Next.js + TypeScript + Tailwind on Supabase (Auth/Postgres/Storage/Realtime); env vars for Supabase URL/keys, canonical host, rate limits, metadata timeout; roles owner/friend/admin; typed API errors + invalid-token not-found state; retain audit events 180 days; no webhooks in V1.

Refs:
- R-01
- R-02
- R-03

Decisions:
- 2026-02-19: Keep one active reservation per item in V1 (quantity fixed at one).
- 2026-02-19: Keep contributions as pledges only, minimum 100 cents, with no in-app payment processing.
- 2026-02-19: Enforce strict surprise mode; owners never see reserver/contributor identities or per-contributor amounts.
- [P0] Q1 [F] Link rotation
  Problem: Owner token reset flow unspecified.
  Answer: Add owner action to regenerate share link; invalidate old token immediately.
- [P1] Q2 [T] Audit retention
  Problem: Retention duration not formally defined.
  Answer: Keep audit events 180 days by default, then purge with a daily job.
- [P1] Q3 [T] Stream fallback
  Problem: Realtime outage fallback unclear.
  Answer: When stream disconnects, poll every 30s and show reconnect status.
