status: pending
id: S-05
topic: brief.md
title: Item CRUD and metadata autofill in editor
Preconditions (P0s): none

Changes:
- routes/components/config: extend `/wishlists/:id` editor with item list and item form panel.
- API/schema: add `POST /api/items`, `PATCH /api/items/:id`, `POST /api/items/:id/archive`, `POST /api/items/metadata`; add `items` table constraints.

Steps:
1. Add owner item list section with add/edit/archive controls.
2. Build item create/edit form with title, URL, price, image, group-funded toggle, target.
3. Default `target_cents` from price when group-funded is enabled.
4. Implement create/update item APIs with owner ownership checks.
5. Implement archive API that sets `archived_at` and blocks hard delete path.
6. Implement URL metadata fetch API with host sanitization and timeout.
7. Keep form usable when metadata autofill fails.
8. Add duplicate-URL warning in-editor without blocking save.
9. Add item-level validation messages and submit loading states.

Design focus:
- Item form remains focused and scannable on mobile.
- Archive action is explicit and separated from edit/save.
- Group-funded toggle clearly reveals target field dependency.
- Metadata autofill feedback never hides manual fields.
- Duplicate URL warning is visible but non-blocking.

Tech focus:
- Validate URL scheme (`http|https`) server-side.
- Validate cents values as non-negative integers.
- Enforce owner-only mutation for item endpoints.
- Keep mutation responses typed and minimal.
- Emit audit event for create/update/archive mutations.

SQL?:
- `items` table with checks for `price_cents` and group-funded target consistency.
- Index for `wishlist_id, archived_at, sort_order`.

Env?:
- `METADATA_TIMEOUT_MS`: timeout for URL metadata fetch.
- `METADATA_BLOCK_PRIVATE_NETWORK`: SSRF protection toggle.

Acceptance:
- Owner can add, edit, and archive item from editor.
- Archived item is hidden from public wishlist responses.
- Group-funded item requires valid target value.
- URL autofill populates available fields when successful.
- URL autofill failure still allows manual save.
- Duplicate URL warning appears but save remains possible.
- Invalid URL scheme is rejected with field error.
- Mutation audit events are written for item actions.

Debts:
- Reorder drag-and-drop can be deferred behind a feature flag.
