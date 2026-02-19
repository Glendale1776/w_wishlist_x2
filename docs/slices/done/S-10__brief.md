status: done
id: S-10
topic: brief.md
title: Observability, abuse controls, and support docs
Preconditions (P0s): none

Changes:
- routes/components/config: add minimal `/admin/abuse` moderation view.
- API/schema: add admin token disable/enable handlers, audit query endpoint, retention cleanup job docs/config.

Steps:
1. Add admin endpoint to disable wishlist share-token access.
2. Add admin endpoint to re-enable disabled share-token access.
3. Build minimal admin abuse page with token status and action buttons.
4. Add audit event query API with filters by wishlist/action/time.
5. Log metadata fetch failures with request id and sanitized host.
6. Log stream connect/disconnect counts and reconnect rates.
7. Document support playbook for abuse triage and token recovery.
8. Add scheduled cleanup for audit retention window (180 days default).

Design focus:
- Admin abuse UI is simple, explicit, and hard to misuse.
- Moderation actions require confirmation to prevent accidental disable.
- Status badges clearly distinguish enabled vs disabled tokens.

Tech focus:
- Admin endpoints require role check and are server-only.
- Disable/enable operations are audited with actor and timestamp.
- Logs redact sensitive data and avoid token plaintext.
- Retention cleanup job is idempotent and monitored.
- Stream metrics capture disconnect reason and retry counts.

SQL?:
- Optional `disabled_share_tokens` table keyed by wishlist id or token hash.
- Index on `audit_events(created_at, action)` for admin filtering.

Env?:
- `AUDIT_RETENTION_DAYS`: audit retention threshold.
- `LOG_REDACTION_MODE`: log redaction strictness.

Acceptance:
- Admin can disable a share token and public route returns not-found.
- Admin can re-enable token and public route works again.
- Disable/enable actions are visible in audit history.
- Audit query endpoint returns filtered events for support triage.
- Metadata fetch failures include request id and sanitized host only.
- Stream metrics capture reconnect behavior.
- Retention cleanup removes events older than configured threshold.

Debts:
- Bulk moderation actions can be deferred.
