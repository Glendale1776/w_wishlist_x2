"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { getAuthenticatedEmail, persistReturnTo } from "@/app/_lib/auth-client";

type ModerationResponse =
  | {
      ok: true;
      alreadyDisabled?: boolean;
      alreadyEnabled?: boolean;
      auditEventId: string | null;
      wishlist: {
        id: string;
        title: string;
        shareTokenDisabledAt: string | null;
      };
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

type AuditResponse =
  | {
      ok: true;
      retentionDays: number;
      cleanup: {
        removedItemEvents: number;
        removedShareLinkEvents: number;
      };
      wishlist: {
        id: string;
        title: string;
        shareTokenDisabledAt: string | null;
        updatedAt: string;
      } | null;
      events: Array<{
        id: string;
        source: "item" | "share_link";
        action: string;
        wishlistId: string;
        entityId: string;
        actorEmail: string;
        createdAt: string;
        details: {
          tokenHint: string;
          disabledAt: string | null;
        } | null;
      }>;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

const AUDIT_ACTION_OPTIONS = [
  { value: "", label: "All actions" },
  { value: "disable_share_link", label: "Disable share link" },
  { value: "enable_share_link", label: "Enable share link" },
  { value: "rotate_share_link", label: "Rotate share link" },
  { value: "reserve", label: "Reserve" },
  { value: "unreserve", label: "Unreserve" },
  { value: "contribute", label: "Contribute" },
  { value: "archive", label: "Archive" },
  { value: "update", label: "Update" },
  { value: "create", label: "Create" },
];

export default function AdminAbusePage() {
  const router = useRouter();

  const [wishlistId, setWishlistId] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [since, setSince] = useState("");

  const [events, setEvents] = useState<
    Array<{
      id: string;
      source: "item" | "share_link";
      action: string;
      wishlistId: string;
      entityId: string;
      actorEmail: string;
      createdAt: string;
      details: {
        tokenHint: string;
        disabledAt: string | null;
      } | null;
    }>
  >([]);

  const [retentionDays, setRetentionDays] = useState<number>(180);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const [wishlistStatus, setWishlistStatus] = useState<{
    id: string;
    title: string;
    shareTokenDisabledAt: string | null;
  } | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const hasWishlistId = wishlistId.trim().length > 0;

  const statusBadge = useMemo(() => {
    if (!wishlistStatus) return null;
    if (wishlistStatus.shareTokenDisabledAt) {
      return {
        label: "Disabled",
        className: "border-rose-300 bg-rose-50 text-rose-900",
      };
    }
    return {
      label: "Enabled",
      className: "border-emerald-300 bg-emerald-50 text-emerald-900",
    };
  }, [wishlistStatus]);

  useEffect(() => {
    let cancelled = false;

    async function ensureAuth() {
      const adminEmail = await getAuthenticatedEmail();
      if (!cancelled && !adminEmail) {
        persistReturnTo("/admin/abuse");
        router.replace("/login?returnTo=%2Fadmin%2Fabuse");
      }
    }

    void ensureAuth();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function fetchAudit() {
    const adminEmail = await getAuthenticatedEmail();
    if (!adminEmail) return;

    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (wishlistId.trim()) params.set("wishlistId", wishlistId.trim());
    if (actionFilter) params.set("action", actionFilter);
    if (since) params.set("since", new Date(since).toISOString());

    try {
      const response = await fetch(`/api/admin/audit-events?${params.toString()}`, {
        headers: {
          "x-admin-email": adminEmail,
        },
      });

      const payload = (await response.json()) as AuditResponse;
      if (!response.ok || !payload.ok) {
        const message = payload && !payload.ok ? payload.error.message : "Unable to load audit events.";
        setError(message);
        setEvents([]);
        setWishlistStatus(null);
        return;
      }

      setEvents(payload.events);
      setRetentionDays(payload.retentionDays);
      setWishlistStatus(payload.wishlist);

      if (payload.cleanup.removedItemEvents > 0 || payload.cleanup.removedShareLinkEvents > 0) {
        setCleanupMessage(
          `Cleanup removed ${payload.cleanup.removedItemEvents + payload.cleanup.removedShareLinkEvents} old events.`,
        );
      } else {
        setCleanupMessage(null);
      }
    } catch {
      setError("Unable to load audit events right now.");
      setEvents([]);
      setWishlistStatus(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function applyModerationAction(mode: "disable" | "enable") {
    const adminEmail = await getAuthenticatedEmail();
    if (!adminEmail) return;

    const nextWishlistId = wishlistId.trim();
    if (!nextWishlistId) {
      setError("Wishlist ID is required.");
      return;
    }

    const confirmed = window.confirm(
      mode === "disable"
        ? "Disable public share access for this wishlist now?"
        : "Re-enable public share access for this wishlist now?",
    );
    if (!confirmed) return;

    setIsMutating(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/admin/share-links/${encodeURIComponent(nextWishlistId)}/${mode}`, {
        method: "POST",
        headers: {
          "x-admin-email": adminEmail,
        },
      });

      const payload = (await response.json()) as ModerationResponse;
      if (!response.ok || !payload.ok) {
        const message = payload && !payload.ok ? payload.error.message : "Unable to run moderation action.";
        setError(message);
        return;
      }

      setWishlistStatus(payload.wishlist);

      if (mode === "disable") {
        setSuccess(payload.alreadyDisabled ? "Share link was already disabled." : "Share link disabled.");
      } else {
        setSuccess(payload.alreadyEnabled ? "Share link was already enabled." : "Share link re-enabled.");
      }

      await fetchAudit();
    } catch {
      setError("Unable to run moderation action right now.");
    } finally {
      setIsMutating(false);
    }
  }

  function onApplyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void fetchAudit();
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Admin abuse tools</h1>
            <p className="mt-1 text-sm text-zinc-600">Disable or re-enable share access and inspect audit history.</p>
          </div>
          <Link className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800" href="/wishlists">
            Back to My wishlists
          </Link>
        </div>

        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Actions are immediate. Confirm wishlist ID before disabling public access.
        </div>
      </header>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <aside className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-zinc-900">Share-link moderation</h2>
          <p className="mt-1 text-sm text-zinc-600">Use one wishlist at a time to reduce mistakes.</p>

          <label className="mt-4 block text-sm">
            <span className="mb-1 block font-medium text-zinc-800">Wishlist ID</span>
            <input
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
              onChange={(event) => setWishlistId(event.target.value)}
              placeholder="Paste wishlist UUID"
              value={wishlistId}
            />
          </label>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="rounded-md border border-rose-300 px-3 py-2 text-sm font-medium text-rose-900 disabled:opacity-60"
              disabled={!hasWishlistId || isMutating}
              onClick={() => applyModerationAction("disable")}
              type="button"
            >
              {isMutating ? "Applying..." : "Disable share link"}
            </button>
            <button
              className="rounded-md border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-900 disabled:opacity-60"
              disabled={!hasWishlistId || isMutating}
              onClick={() => applyModerationAction("enable")}
              type="button"
            >
              {isMutating ? "Applying..." : "Re-enable share link"}
            </button>
          </div>

          {wishlistStatus ? (
            <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-sm font-semibold text-zinc-900">{wishlistStatus.title}</p>
              <p className="mt-1 text-xs text-zinc-600 break-all">{wishlistStatus.id}</p>
              {statusBadge ? (
                <span className={`mt-2 inline-flex rounded-full border px-2 py-1 text-xs font-medium ${statusBadge.className}`}>
                  {statusBadge.label}
                </span>
              ) : null}
              {wishlistStatus.shareTokenDisabledAt ? (
                <p className="mt-2 text-xs text-zinc-600">
                  Disabled at {new Date(wishlistStatus.shareTokenDisabledAt).toLocaleString()}
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
          {success ? <p className="mt-3 text-sm text-emerald-700">{success}</p> : null}

          <div className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
            <p className="font-semibold text-zinc-900">Support playbook</p>
            <p className="mt-1">1. Verify wishlist ID and current status.</p>
            <p className="mt-1">2. Disable token for abuse; re-enable only after owner confirmation.</p>
            <p className="mt-1">3. Review audit timeline and retain logs for {retentionDays} days.</p>
          </div>
        </aside>

        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-zinc-900">Audit events</h2>

          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={onApplyFilters}>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-zinc-800">Action</span>
              <select
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                onChange={(event) => setActionFilter(event.target.value)}
                value={actionFilter}
              >
                {AUDIT_ACTION_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block font-medium text-zinc-800">Since</span>
              <input
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                onChange={(event) => setSince(event.target.value)}
                type="datetime-local"
                value={since}
              />
            </label>

            <div className="sm:col-span-2 flex flex-wrap gap-2">
              <button
                className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                disabled={isLoading}
                type="submit"
              >
                {isLoading ? "Loading..." : "Refresh audit"}
              </button>
              <button
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800"
                onClick={() => {
                  setActionFilter("");
                  setSince("");
                  setEvents([]);
                  setCleanupMessage(null);
                }}
                type="button"
              >
                Clear filters
              </button>
            </div>
          </form>

          {cleanupMessage ? <p className="mt-3 text-xs text-zinc-600">{cleanupMessage}</p> : null}

          <div className="mt-4 space-y-3">
            {events.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-600">
                No audit events loaded yet.
              </div>
            ) : (
              events.map((event) => (
                <article className="rounded-lg border border-zinc-200 p-3" key={event.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-zinc-900">{event.action}</p>
                    <p className="text-xs text-zinc-500">{new Date(event.createdAt).toLocaleString()}</p>
                  </div>
                  <p className="mt-1 text-xs text-zinc-600">Source: {event.source}</p>
                  <p className="mt-1 text-xs text-zinc-600 break-all">Wishlist: {event.wishlistId}</p>
                  <p className="mt-1 text-xs text-zinc-600 break-all">Actor: {event.actorEmail}</p>
                  {event.details ? (
                    <p className="mt-1 text-xs text-zinc-600">
                      Token hint: {event.details.tokenHint}
                      {event.details.disabledAt ? ` • disabled at ${new Date(event.details.disabledAt).toLocaleString()}` : ""}
                    </p>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
