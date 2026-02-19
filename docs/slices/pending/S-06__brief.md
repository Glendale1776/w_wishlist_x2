status: pending
id: S-06
topic: brief.md
title: Image upload limits and secure preview flow
Preconditions (P0s): none

Changes:
- routes/components/config: add image upload controls to item form and preview UI.
- API/schema: add `POST /api/items/:id/image-upload-url`; configure Supabase Storage policies and signed preview retrieval.

Steps:
1. Add image picker with replace/remove actions inside item form.
2. Validate MIME type and file size client-side before upload request.
3. Add signed upload URL API for owner item image writes.
4. Upload to owner-scoped Storage path and persist image reference.
5. Add signed preview URL retrieval for private image display.
6. Revalidate file size/type server-side before issuing upload URL.
7. Show clear upload progress, failure message, and retry path.

Design focus:
- Preview state is stable while upload runs.
- Remove/replace affordances are obvious on small screens.
- Upload errors are inline and non-destructive to other form fields.
- Fallback placeholder appears when image is absent.

Tech focus:
- Enforce `10 MB` maximum at client and server.
- Restrict accepted MIME list to common image formats.
- Keep storage objects private by default.
- Ensure signed URLs are short-lived and non-cache-leaky.

SQL?:
- none

Env?:
- `MAX_UPLOAD_MB`: maximum accepted upload size.
- `ALLOWED_IMAGE_MIME`: comma-separated allowed MIME types.
- `SIGNED_URL_TTL_SEC`: preview URL expiration.

Acceptance:
- Upload over limit is blocked before network upload.
- Server rejects oversized file even if client check is bypassed.
- Non-image MIME file is rejected with clear error.
- Successful upload renders preview in item form and item card.
- Replace action updates preview without stale cache leak.
- Remove action clears stored reference safely.
- Signed preview URL expires and requires refresh.

Debts:
- HEIC conversion support can be deferred.
