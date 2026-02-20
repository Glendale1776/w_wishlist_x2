"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { getAuthenticatedEmail, persistReturnTo } from "@/app/_lib/auth-client";

type ActivityApiResponse =
  | {
      ok: true;
      activities: Array<{
        id: string;
        kind: "reservation" | "contribution" | "visit";
        action: "reserved" | "unreserved" | "contributed" | "opened_wishlist";
        wishlistId: string;
        wishlistTitle: string;
        itemId: string | null;
        itemTitle: string | null;
        amountCents: number | null;
        status: "active" | "released" | null;
        openCount: number | null;
        happenedAt: string;
        openItemPath: string | null;
      }>;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

function formatMoney(cents: number | null) {
  if (cents === null) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

export default function ActivityPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<
    Array<{
      id: string;
      kind: "reservation" | "contribution" | "visit";
      action: "reserved" | "unreserved" | "contributed" | "opened_wishlist";
      wishlistId: string;
      wishlistTitle: string;
      itemId: string | null;
      itemTitle: string | null;
      amountCents: number | null;
      status: "active" | "released" | null;
      openCount: number | null;
      happenedAt: string;
      openItemPath: string | null;
    }>
  >([]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const actorEmail = await getAuthenticatedEmail();
      if (!actorEmail) {
        persistReturnTo("/me/activity");
        router.replace("/login?returnTo=%2Fme%2Factivity");
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/me/activity", {
          headers: {
            "x-actor-email": actorEmail,
          },
        });

        const payload = (await response.json()) as ActivityApiResponse;
        if (cancelled) return;

        if (!response.ok || !payload.ok) {
          const message = payload && !payload.ok ? payload.error.message : "Unable to load activity.";
          setError(message);
          setRows([]);
          return;
        }

        setRows(payload.activities);
      } catch {
        if (!cancelled) {
          setError("Unable to load activity. Please retry.");
          setRows([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;

    return rows.filter((row) => {
      return (
        row.wishlistTitle.toLowerCase().includes(needle) ||
        (row.itemTitle || "").toLowerCase().includes(needle) ||
        row.action.toLowerCase().includes(needle)
      );
    });
  }, [rows, search]);

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">My activity</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Your opened wishlists, reservations, and contributions across shared wishlists.
            </p>
          </div>
          <Link className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800" href="/wishlists">
            Back to My wishlists
          </Link>
        </div>

        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-medium text-zinc-800">Search</span>
          <input
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by wishlist or item"
            value={search}
          />
        </label>
      </header>

      <section className="mt-6 space-y-3">
        {isLoading ? (
          <>
            <div className="h-24 animate-pulse rounded-xl border border-zinc-200 bg-white" />
            <div className="h-24 animate-pulse rounded-xl border border-zinc-200 bg-white" />
          </>
        ) : error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-600">
            No activity yet.
          </div>
        ) : (
          filteredRows.map((row) => (
            <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm" key={row.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900">{row.wishlistTitle}</h2>
                  <p className="mt-1 text-sm text-zinc-700">{row.itemTitle || "Wishlist opened"}</p>
                  <p className="mt-1 text-xs text-zinc-600">
                    {row.action === "opened_wishlist"
                      ? `Opened wishlist${row.openCount && row.openCount > 1 ? ` • ${row.openCount} visits` : ""}`
                      : row.action === "contributed"
                        ? "Contributed"
                        : row.action === "reserved"
                          ? "Reserved"
                          : "Released reservation"}
                    {row.amountCents !== null ? ` • ${formatMoney(row.amountCents)}` : ""}
                    {row.status ? ` • ${row.status}` : ""}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-xs text-zinc-500">{new Date(row.happenedAt).toLocaleString()}</p>
                  {row.openItemPath ? (
                    <Link
                      className="mt-2 inline-flex rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-800"
                      href={row.openItemPath}
                    >
                      {row.action === "opened_wishlist" ? "Open wishlist" : "Open item"}
                    </Link>
                  ) : null}
                </div>
              </div>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
