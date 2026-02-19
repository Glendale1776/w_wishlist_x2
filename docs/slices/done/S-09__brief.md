status: done
id: S-09
topic: brief.md
title: Secrets lifecycle and share-link rotation
Preconditions (P0s): Q1

Changes:
- routes/components/config: add owner share-link settings actions in wishlist editor.
- API/schema: add `POST /api/wishlists/:id/rotate-share-link`; rotate hash/hint and one-time reveal token UX.

Steps:
1. Add owner-only "Regenerate link" action in wishlist editor settings.
2. Generate cryptographically strong replacement token server-side.
3. Hash and store new token, invalidate previous token immediately.
4. Return new token only in rotate response; do not store plaintext.
5. Show one-time reveal UI with copy action and dismiss behavior.
6. Add audit event for link rotation with redacted metadata.
7. Ensure old public URLs return not-found after rotation.

Design focus:
- Rotation action has clear irreversible warning copy.
- One-time reveal screen emphasizes copy-now behavior.
- Success/error states are explicit and non-ambiguous.

Tech focus:
- Token generation uses secure random bytes and URL-safe encoding.
- No logs contain plaintext token or full URL query fragments.
- Rotation endpoint requires owner auth and wishlist ownership.
- Old token invalidation is atomic with new hash write.
- Rotation is idempotent-safe for client retries.

SQL?:
- Optional `wishlists.share_token_rotated_at` timestamp for audit/debug.

Env?:
- `SHARE_TOKEN_BYTES`: entropy size for generated tokens.
- `SHARE_TOKEN_PEPPER`: server-only pepper for token hashing.

Acceptance:
- Owner can rotate share link from editor settings.
- New link works immediately after rotation.
- Old link fails immediately after rotation.
- Plaintext token appears only once in rotation response/UI.
- Server never persists plaintext token.
- Rotation events appear in audit trail.
- Non-owner rotation requests return forbidden.

Debts:
- Token rollback workflow is intentionally unsupported.
