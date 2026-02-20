"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { getAuthenticatedOwnerHeaders, persistReturnTo } from "@/app/_lib/auth-client";
import {
  ApiErrorResponse,
  createWishlistsQuery,
  parseWishlistSort,
  WishlistListResponse,
  WishlistPreview,
  WishlistSort,
  WishlistUpdateResponse,
} from "@/app/_lib/wishlist-shell";

type ToastState = {
  message: string;
  kind: "success" | "error";
} | null;

type WishlistEditDraft = {
  title: string;
  occasionDate: string;
  occasionNote: string;
};

type WishlistEditFieldErrors = Partial<Record<keyof WishlistEditDraft, string>>;

const TITLE_MAX = 80;
const NOTE_MAX = 200;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function WishlistsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [toast, setToast] = useState<ToastState>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [list, setList] = useState<WishlistPreview[]>([]);
  const [deletingWishlistId, setDeletingWishlistId] = useState<string | null>(null);
  const [editingWishlistId, setEditingWishlistId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<WishlistEditDraft>({
    title: "",
    occasionDate: "",
    occasionNote: "",
  });
  const [editFieldErrors, setEditFieldErrors] = useState<WishlistEditFieldErrors>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [savingWishlistId, setSavingWishlistId] = useState<string | null>(null);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement | null>(null);

  const search = searchParams.get("search") || "";
  const sort = parseWishlistSort(searchParams.get("sort"));
  const created = searchParams.get("created") === "1";
  const hasActiveFilters = Boolean(search.trim()) || sort !== "updated_desc";

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
    if (!isFiltersOpen) return;

    function onDocumentMouseDown(event: MouseEvent) {
      const target = event.target;
      if (!filtersRef.current || !(target instanceof Node)) return;
      if (!filtersRef.current.contains(target)) setIsFiltersOpen(false);
    }

    function onDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsFiltersOpen(false);
    }

    document.addEventListener("mousedown", onDocumentMouseDown);
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocumentMouseDown);
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [isFiltersOpen]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const query = createWishlistsQuery(search, sort);
      const returnTo = query ? `/wishlists?${query}` : "/wishlists";
      const ownerHeaders = await getAuthenticatedOwnerHeaders();
      if (!ownerHeaders) {
        persistReturnTo(returnTo);
        router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
        return;
      }

      setIsLoading(true);
      setLoadError(null);

      try {
        const response = await fetch(`/api/wishlists${query ? `?${query}` : ""}`, {
          headers: ownerHeaders,
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

  function resetFilters() {
    setQueryValues({ search: "", sort: "updated_desc" });
  }

  function validateWishlistDraft(draft: WishlistEditDraft): WishlistEditFieldErrors {
    const errors: WishlistEditFieldErrors = {};
    const title = draft.title.trim();
    const occasionDate = draft.occasionDate.trim();
    const occasionNote = draft.occasionNote.trim();

    if (!title) errors.title = "Wishlist title is required.";
    if (title.length > TITLE_MAX) errors.title = `Title must be ${TITLE_MAX} characters or less.`;
    if (occasionDate && !DATE_REGEX.test(occasionDate)) {
      errors.occasionDate = "Occasion date must use YYYY-MM-DD.";
    }
    if (occasionNote.length > NOTE_MAX) {
      errors.occasionNote = `Occasion note must be ${NOTE_MAX} characters or less.`;
    }

    return errors;
  }

  function startEditingWishlist(item: WishlistPreview) {
    setEditingWishlistId(item.id);
    setEditFieldErrors({});
    setEditError(null);
    setEditDraft({
      title: item.title,
      occasionDate: item.occasionDate || "",
      occasionNote: item.occasionNote || "",
    });
  }

  function cancelEditingWishlist() {
    setEditingWishlistId(null);
    setEditFieldErrors({});
    setEditError(null);
    setEditDraft({
      title: "",
      occasionDate: "",
      occasionNote: "",
    });
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

    const ownerHeaders = await getAuthenticatedOwnerHeaders();
    if (!ownerHeaders) {
      persistReturnTo("/wishlists");
      router.replace("/login?returnTo=/wishlists");
      return;
    }

    setDeletingWishlistId(item.id);

    let response: Response;
    try {
      response = await fetch(`/api/wishlists/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        headers: ownerHeaders,
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
    if (editingWishlistId === payload.deletedWishlistId) {
      cancelEditingWishlist();
    }
    setToast({ kind: "success", message: "Wishlist deleted." });
  }

  async function saveWishlistDetails(item: WishlistPreview) {
    const fieldErrors = validateWishlistDraft(editDraft);
    setEditFieldErrors(fieldErrors);
    setEditError(null);
    if (Object.keys(fieldErrors).length > 0) return;

    const ownerHeaders = await getAuthenticatedOwnerHeaders();
    if (!ownerHeaders) {
      persistReturnTo("/wishlists");
      router.replace("/login?returnTo=/wishlists");
      return;
    }

    setSavingWishlistId(item.id);

    let response: Response;
    try {
      response = await fetch(`/api/wishlists/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...ownerHeaders,
        },
        body: JSON.stringify({
          title: editDraft.title.trim(),
          occasionDate: editDraft.occasionDate.trim() || null,
          occasionNote: editDraft.occasionNote.trim() || null,
        }),
      });
    } catch {
      setSavingWishlistId(null);
      setEditError("Unable to save wishlist details right now. Please retry.");
      return;
    }

    const payload = (await response.json()) as WishlistUpdateResponse | ApiErrorResponse;
    setSavingWishlistId(null);

    if (!response.ok || !payload.ok) {
      if (response.status === 401) {
        persistReturnTo("/wishlists");
        router.replace("/login?returnTo=/wishlists");
        return;
      }

      if (!payload.ok && payload.error.fieldErrors) {
        setEditFieldErrors((current) => ({ ...current, ...payload.error.fieldErrors }));
      }
      const message =
        payload && !payload.ok ? payload.error.message : "Unable to save wishlist details right now.";
      setEditError(message);
      return;
    }

    setList((current) =>
      current.map((entry) => (entry.id === payload.wishlist.id ? payload.wishlist : entry)),
    );
    cancelEditingWishlist();
    setToast({ kind: "success", message: "Wishlist details updated." });
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
          <div className="flex items-center gap-2">
            <div className="relative" ref={filtersRef}>
              <button
                aria-expanded={isFiltersOpen}
                aria-haspopup="dialog"
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  hasActiveFilters
                    ? "border-sky-300 bg-sky-50 text-sky-900"
                    : "border-zinc-300 bg-white/80 text-zinc-700 hover:bg-white"
                }`}
                onClick={() => setIsFiltersOpen((current) => !current)}
                type="button"
              >
                Filters
              </button>

              {isFiltersOpen ? (
                <div
                  className="absolute right-0 top-full z-30 mt-2 w-[min(92vw,320px)] rounded-xl border border-zinc-200 bg-white p-3 shadow-lg"
                  role="dialog"
                >
                  <label className="text-xs">
                    <span className="mb-1 block font-medium text-zinc-700">Search</span>
                    <input
                      className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                      onChange={(event) => setQueryValues({ search: event.target.value })}
                      placeholder="Search by title"
                      value={search}
                    />
                  </label>

                  <label className="mt-3 block text-xs">
                    <span className="mb-1 block font-medium text-zinc-700">Sort</span>
                    <select
                      className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                      onChange={(event) => setQueryValues({ sort: parseWishlistSort(event.target.value) })}
                      value={sort}
                    >
                      <option value="updated_desc">Most recently updated</option>
                      <option value="title_asc">Title (A-Z)</option>
                    </select>
                  </label>

                  <div className="mt-3 flex items-center justify-between">
                    <button
                      className="text-xs font-medium text-zinc-500 underline underline-offset-2 disabled:no-underline disabled:opacity-40"
                      disabled={!hasActiveFilters}
                      onClick={resetFilters}
                      type="button"
                    >
                      Clear filters
                    </button>
                    <button
                      className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      onClick={() => setIsFiltersOpen(false)}
                      type="button"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <Link className="btn-notch btn-notch--ink" href="/onboarding">
              Create wishlist
            </Link>
          </div>
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
          list.map((item) => {
            const isEditing = editingWishlistId === item.id;
            return (
              <article className="border-b border-zinc-300/80 px-2 pb-5 pt-2 last:border-b-0 sm:px-3" key={item.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-900">{item.title}</h2>
                    <p className="mt-1 text-xs text-zinc-600">
                      {item.occasionDate ? `Occasion date: ${item.occasionDate}` : "No occasion date"}
                    </p>
                    {item.occasionNote ? <p className="mt-2 text-sm text-zinc-700">{item.occasionNote}</p> : null}
                  </div>
                  <p className="text-xs text-zinc-500">Updated {new Date(item.updatedAt).toLocaleDateString()}</p>
                </div>

                {isEditing ? (
                  <div className="mt-4 max-w-2xl space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-zinc-700" htmlFor={`wishlist-title-${item.id}`}>
                        Wishlist name
                      </label>
                      <input
                        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                        id={`wishlist-title-${item.id}`}
                        maxLength={TITLE_MAX}
                        onChange={(event) =>
                          setEditDraft((current) => ({ ...current, title: event.target.value }))
                        }
                        value={editDraft.title}
                      />
                      {editFieldErrors.title ? <p className="mt-1 text-xs text-rose-700">{editFieldErrors.title}</p> : null}
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-zinc-700" htmlFor={`wishlist-date-${item.id}`}>
                        Occasion date
                      </label>
                      <input
                        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                        id={`wishlist-date-${item.id}`}
                        onChange={(event) =>
                          setEditDraft((current) => ({ ...current, occasionDate: event.target.value }))
                        }
                        type="date"
                        value={editDraft.occasionDate}
                      />
                      {editFieldErrors.occasionDate ? (
                        <p className="mt-1 text-xs text-rose-700">{editFieldErrors.occasionDate}</p>
                      ) : null}
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-zinc-700" htmlFor={`wishlist-note-${item.id}`}>
                        Description
                      </label>
                      <textarea
                        className="min-h-24 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                        id={`wishlist-note-${item.id}`}
                        maxLength={NOTE_MAX}
                        onChange={(event) =>
                          setEditDraft((current) => ({ ...current, occasionNote: event.target.value }))
                        }
                        value={editDraft.occasionNote}
                      />
                      {editFieldErrors.occasionNote ? (
                        <p className="mt-1 text-xs text-rose-700">{editFieldErrors.occasionNote}</p>
                      ) : null}
                    </div>

                    {editError ? <p className="text-sm text-rose-700">{editError}</p> : null}

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="btn-notch btn-notch--ink"
                        disabled={savingWishlistId === item.id}
                        onClick={() => void saveWishlistDetails(item)}
                        type="button"
                      >
                        {savingWishlistId === item.id ? "Saving..." : "Save details"}
                      </button>
                      <button className="btn-notch" onClick={cancelEditingWishlist} type="button">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button className="btn-notch" onClick={() => startEditingWishlist(item)} type="button">
                      Edit details
                    </button>
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
                )}
              </article>
            );
          })
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
