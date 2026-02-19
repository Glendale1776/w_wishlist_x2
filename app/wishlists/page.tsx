"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import {
  buildShareUrl,
  filterAndSortWishlists,
  MOCK_WISHLISTS,
  parseWishlistSort,
  parseWishlistViewState,
  WishlistSort,
  WishlistViewState,
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

  const search = searchParams.get("search") || "";
  const sort = parseWishlistSort(searchParams.get("sort"));
  const view = parseWishlistViewState(searchParams.get("state"));

  useEffect(() => {
    setIsLoading(true);
    const timer = window.setTimeout(() => setIsLoading(false), 550);
    return () => window.clearTimeout(timer);
  }, [search, sort, view]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const list = useMemo(() => {
    const source = view === "empty" ? [] : MOCK_WISHLISTS;
    return filterAndSortWishlists(source, search, sort);
  }, [search, sort, view]);

  function setQueryValues(next: {
    search?: string;
    sort?: WishlistSort;
    state?: WishlistViewState;
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

    if (next.state !== undefined) {
      if (next.state === "populated") params.delete("state");
      else params.set("state", next.state);
    }

    const query = params.toString();
    router.replace(query ? `/wishlists?${query}` : "/wishlists");
  }

  async function copyShareLink(token: string) {
    const shareUrl = buildShareUrl(token);

    try {
      await navigator.clipboard.writeText(shareUrl);
      setToast({ kind: "success", message: "Share link copied." });
    } catch {
      setToast({ kind: "error", message: "Clipboard unavailable. Copy link manually." });
    }
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

      <header className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">My wishlists</h1>
            <p className="mt-1 text-sm text-zinc-600">Search, sort, and share your wishlist links quickly.</p>
          </div>
          <Link
            className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
            href="/onboarding"
          >
            Create wishlist
          </Link>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
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

          <label className="text-sm">
            <span className="mb-1 block font-medium text-zinc-800">Mock state</span>
            <select
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
              onChange={(event) => setQueryValues({ state: parseWishlistViewState(event.target.value) })}
              value={view}
            >
              <option value="populated">Populated</option>
              <option value="empty">Empty</option>
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
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center">
            <h2 className="text-base font-semibold text-zinc-900">No wishlists yet</h2>
            <p className="mt-2 text-sm text-zinc-600">Start a new wishlist to copy and share your first public link.</p>
            <Link
              className="mt-4 inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
              href="/onboarding"
            >
              Start onboarding
            </Link>
          </div>
        ) : (
          list.map((item) => (
            <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm" key={item.id}>
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
                <Link
                  className="inline-flex items-center rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800"
                  href={`/wishlists/${item.id}`}
                >
                  Open editor
                </Link>
                <button
                  className="inline-flex items-center rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white"
                  onClick={() => copyShareLink(item.shareToken)}
                  type="button"
                >
                  Copy share link
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
