"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { getAuthenticatedEmail, persistReturnTo } from "@/app/_lib/auth-client";
import {
  ApiErrorResponse,
  createWishlistsQuery,
  parseWishlistSort,
  WishlistListResponse,
  WishlistPreview,
  WishlistSort,
} from "@/app/_lib/wishlist-shell";

type ToastState = {
  message: string;
  kind: "success" | "error";
} | null;

function WishlistsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [toast, setToast] = useState<ToastState>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [list, setList] = useState<WishlistPreview[]>([]);
  const [deletingWishlistId, setDeletingWishlistId] = useState<string | null>(null);

  const search = searchParams.get("search") || "";
  const sort = parseWishlistSort(searchParams.get("sort"));
  const created = searchParams.get("created") === "1";

  useEffect(() => {
    if (!created) return;

    setToast({ kind: "success", message: "Wishlist created." });
    const params = new URLSearchParams(searchParams.toString());
    params.delete("created");
    const next = params.toString();
    router.replace(next ? `/wishlists?${next}` : "/wishlists");
  }, [created, router, searchParams]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const query = createWishlistsQuery(search, sort);
      const returnTo = query ? `/wishlists?${query}` : "/wishlists";
      const ownerEmail = await getAuthenticatedEmail();

      if (!ownerEmail) {
        persistReturnTo(returnTo);
        router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
        return;
      }

      setIsLoading(true);
      setLoadError(null);

      try {
        const response = await fetch(`/api/wishlists${query ? `?${query}` : ""}`, {
          headers: { "x-owner-email": ownerEmail },
        });

        const payload = (await response.json()) as WishlistListResponse | ApiErrorResponse;

        if (cancelled) return;

        if (!response.ok || !payload.ok) {
          const message = payload && !payload.ok ? payload.error.message : "Unable to load wishlists.";
          if (response.status === 401) {
            persistReturnTo(returnTo);
            router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
            return;
          }
          setLoadError(message);
          setList([]);
          return;
        }

        setList(payload.wishlists);
      } catch {
        if (cancelled) return;
        setLoadError("Unable to load wishlists. Please retry.");
        setList([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [search, sort, router]);

  function setQueryValues(next: {
    search?: string;
    sort?: WishlistSort;
  }) {
    const params = new URLSearchParams(searchParams.toString());

    if (next.search !== undefined) {
      if (next.search.trim()) params.set("search", next.search);
      else params.delete("search");
    }

    if (next.sort !== undefined) {
      if (next.sort === "updated_desc") params.delete("sort");
      else params.set("sort", next.sort);
    }

    params.delete("created");

    const query = params.toString();
    router.replace(query ? `/wishlists?${query}` : "/wishlists");
  }

  async function copyShareLink(shareUrl: string) {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setToast({ kind: "success", message: "Share link copied." });
    } catch {
      setToast({ kind: "error", message: "Clipboard unavailable. Copy link manually." });
    }
  }

  async function deleteWishlist(item: WishlistPreview) {
    const confirmed = window.confirm(
      `Delete "${item.title}"?\n\nThis will permanently delete the wishlist, all its items, and its share link.`,
    );
    if (!confirmed) return;

    const ownerEmail = await getAuthenticatedEmail();
    if (!ownerEmail) {
      persistReturnTo("/wishlists");
      router.replace("/login?returnTo=/wishlists");
      return;
    }

    setDeletingWishlistId(item.id);

    let response: Response;
    try {
      response = await fetch(`/api/wishlists/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        headers: {
          "x-owner-email": ownerEmail,
        },
      });
    } catch {
      setDeletingWishlistId(null);
      setToast({ kind: "error", message: "Unable to delete wishlist right now. Please retry." });
      return;
    }

    const payload = (await response.json()) as
      | {
          ok: true;
          deletedWishlistId: string;
        }
      | ApiErrorResponse;

    setDeletingWishlistId(null);

    if (!response.ok || !payload.ok) {
      if (response.status === 401) {
        persistReturnTo("/wishlists");
        router.replace("/login?returnTo=/wishlists");
        return;
      }

      const message = payload && !payload.ok ? payload.error.message : "Unable to delete wishlist right now.";
      setToast({ kind: "error", message });
      return;
    }

    setList((current) => current.filter((entry) => entry.id !== payload.deletedWishlistId));
    setToast({ kind: "success", message: "Wishlist deleted." });
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      {toast ? (
        <div
          className={`fixed inset-x-4 top-4 z-50 mx-auto max-w-md rounded-md border px-4 py-3 text-sm shadow-sm ${
            toast.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
          role="status"
        >
          {toast.message}
        </div>
      ) : null}

      <header className="px-2 pb-4 sm:px-3 sm:pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">My wishlists</h1>
            <p className="mt-1 text-sm text-zinc-600">Search, sort, and share your wishlist links quickly.</p>
          </div>
          <Link className="btn-notch btn-notch--ink" href="/onboarding">
            Create wishlist
          </Link>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-zinc-800">Search</span>
            <input
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
              onChange={(event) => setQueryValues({ search: event.target.value })}
              placeholder="Search by title"
              value={search}
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium text-zinc-800">Sort</span>
            <select
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
              onChange={(event) => setQueryValues({ sort: parseWishlistSort(event.target.value) })}
              value={sort}
            >
              <option value="updated_desc">Most recently updated</option>
              <option value="title_asc">Title (A-Z)</option>
            </select>
          </label>
        </div>
      </header>

      <section className="mt-6 space-y-3">
        {isLoading ? (
          <>
            <div className="h-24 animate-pulse rounded-xl border border-zinc-200 bg-white" />
            <div className="h-24 animate-pulse rounded-xl border border-zinc-200 bg-white" />
          </>
        ) : loadError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
            <p>{loadError}</p>
            <button
              className="btn-notch btn-notch--rose mt-3 text-xs"
              onClick={() => router.refresh()}
              type="button"
            >
              Retry
            </button>
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center">
            <h2 className="text-base font-semibold text-zinc-900">No wishlists yet</h2>
            <p className="mt-2 text-sm text-zinc-600">Start a new wishlist to copy and share your first public link.</p>
            <Link className="btn-notch btn-notch--ink mt-4" href="/onboarding">
              Start onboarding
            </Link>
          </div>
        ) : (
          list.map((item) => (
            <article className="border-b border-zinc-300/80 px-2 pb-5 pt-2 last:border-b-0 sm:px-3" key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-zinc-900">{item.title}</h2>
                  <p className="mt-1 text-xs text-zinc-600">
                    {item.occasionDate ? `Occasion date: ${item.occasionDate}` : "No occasion date"}
                  </p>
                </div>
                <p className="text-xs text-zinc-500">Updated {new Date(item.updatedAt).toLocaleDateString()}</p>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Link className="btn-notch" href={`/wishlists/${item.id}`}>
                  Open editor
                </Link>
                <button
                  className="btn-notch btn-notch--ink"
                  onClick={() => copyShareLink(item.shareUrlPreview)}
                  type="button"
                >
                  Copy share link
                </button>
                <button
                  className="btn-notch btn-notch--rose"
                  disabled={deletingWishlistId === item.id}
                  onClick={() => void deleteWishlist(item)}
                  type="button"
                >
                  {deletingWishlistId === item.id ? "Deleting..." : "Delete wishlist"}
                </button>
              </div>
            </article>
          ))
        )}
      </section>
    </main>
  );
}

function WishlistsFallback() {
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="h-24 animate-pulse rounded-xl border border-zinc-200 bg-white" />
    </main>
  );
}

export default function WishlistsPage() {
  return (
    <Suspense fallback={<WishlistsFallback />}>
      <WishlistsContent />
    </Suspense>
  );
}
