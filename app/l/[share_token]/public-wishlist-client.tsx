"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type ApiErrorResponse = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

type PublicWishlistResponse =
  | {
      ok: true;
      version: string;
      wishlist: {
        id: string;
        title: string;
        occasionDate: string | null;
        occasionNote: string | null;
        currency: string;
        shareUrl: string;
        itemCount: number;
      };
      items: Array<{
        id: string;
        title: string;
        url: string | null;
        imageUrl: string | null;
        priceCents: number | null;
        isGroupFunded: boolean;
        targetCents: number | null;
        fundedCents: number;
        progressRatio: number;
        availability: "available" | "reserved";
      }>;
    }
  | ApiErrorResponse;

type StreamMessage =
  | {
      type: "snapshot";
      version: string;
      wishlist: {
        id: string;
        title: string;
        occasionDate: string | null;
        occasionNote: string | null;
        currency: string;
        shareUrl: string;
        itemCount: number;
      };
      items: Array<{
        id: string;
        title: string;
        url: string | null;
        imageUrl: string | null;
        priceCents: number | null;
        isGroupFunded: boolean;
        targetCents: number | null;
        fundedCents: number;
        progressRatio: number;
        availability: "available" | "reserved";
      }>;
    }
  | {
      type: "heartbeat";
      version: string;
    }
  | {
      type: "not_found";
    };

type PublicWishlistModel = Extract<PublicWishlistResponse, { ok: true }>;

type ConnectionState = "connecting" | "live" | "disconnected";

function formatMoney(cents: number | null, currency: string) {
  if (cents === null) return "Not set";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function formatDate(value: string | null) {
  if (!value) return "No date set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "No date set";
  return parsed.toLocaleDateString();
}

function buildAuthReturnTo(shareToken: string, itemId: string) {
  const returnTo = `/l/${shareToken}?item=${itemId}`;
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export default function PublicWishlistClient({ shareToken }: { shareToken: string }) {
  const [model, setModel] = useState<PublicWishlistModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");

  const [search, setSearch] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<"all" | "available" | "reserved">("all");
  const [fundingFilter, setFundingFilter] = useState<"all" | "group" | "single">("all");

  const applyModel = useCallback((nextModel: PublicWishlistModel, preserveScroll: boolean) => {
    if (!preserveScroll || typeof window === "undefined") {
      setModel(nextModel);
      return;
    }

    const scrollY = window.scrollY;
    setModel(nextModel);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: "auto" });
    });
  }, []);

  const loadPublicModel = useCallback(async () => {
    const response = await fetch(`/api/public/${encodeURIComponent(shareToken)}/wishlist`, {
      cache: "no-store",
    });

    const payload = (await response.json()) as PublicWishlistResponse;

    if (!response.ok || !payload.ok) {
      const message = payload && !payload.ok ? payload.error.message : "This shared wishlist is unavailable.";
      throw new Error(message);
    }

    return payload;
  }, [shareToken]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setIsLoading(true);
      setPageError(null);

      try {
        const payload = await loadPublicModel();
        if (cancelled) return;
        setModel(payload);
      } catch (error) {
        if (cancelled) return;
        setPageError(error instanceof Error ? error.message : "This shared wishlist is unavailable.");
        setModel(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [loadPublicModel]);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const clearReconnect = () => {
      if (!reconnectTimer) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const connect = () => {
      if (cancelled) return;

      if (source) {
        source.close();
        source = null;
      }

      setConnectionState((current) => (current === "disconnected" ? "connecting" : current));

      source = new EventSource(`/api/public/${encodeURIComponent(shareToken)}/stream`);

      source.onopen = () => {
        if (cancelled) return;
        setConnectionState("live");
      };

      source.onmessage = (event) => {
        if (cancelled) return;

        let message: StreamMessage;
        try {
          message = JSON.parse(event.data) as StreamMessage;
        } catch {
          return;
        }

        if (message.type === "heartbeat") {
          return;
        }

        if (message.type === "not_found") {
          setPageError("This shared wishlist is unavailable.");
          setModel(null);
          setConnectionState("disconnected");
          if (source) {
            source.close();
            source = null;
          }
          return;
        }

        applyModel(
          {
            ok: true,
            version: message.version,
            wishlist: message.wishlist,
            items: message.items,
          },
          true,
        );
        setPageError(null);
      };

      source.onerror = () => {
        if (cancelled) return;
        setConnectionState("disconnected");

        if (source) {
          source.close();
          source = null;
        }

        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 5000);
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      clearReconnect();
      if (source) source.close();
    };
  }, [applyModel, shareToken]);

  useEffect(() => {
    if (connectionState !== "disconnected") return;

    let cancelled = false;

    const poll = async () => {
      try {
        const payload = await loadPublicModel();
        if (cancelled) return;
        applyModel(payload, true);
        setPageError(null);
      } catch (error) {
        if (cancelled) return;
        setPageError(error instanceof Error ? error.message : "Live refresh failed.");
      }
    };

    void poll();
    const interval = setInterval(poll, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [applyModel, connectionState, loadPublicModel]);

  const filteredItems = useMemo(() => {
    if (!model) return [];

    const needle = search.trim().toLowerCase();

    return model.items.filter((item) => {
      if (needle && !item.title.toLowerCase().includes(needle)) return false;
      if (availabilityFilter !== "all" && item.availability !== availabilityFilter) return false;
      if (fundingFilter === "group" && !item.isGroupFunded) return false;
      if (fundingFilter === "single" && item.isGroupFunded) return false;
      return true;
    });
  }, [availabilityFilter, fundingFilter, model, search]);

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      {connectionState === "disconnected" ? (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Live updates are reconnecting. Poll fallback runs every 30 seconds.
        </div>
      ) : null}

      {connectionState === "connecting" ? (
        <div className="mb-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          Connecting live updates...
        </div>
      ) : null}

      {isLoading ? (
        <section className="space-y-3">
          <div className="h-24 animate-pulse rounded-2xl border border-zinc-200 bg-white" />
          <div className="h-24 animate-pulse rounded-2xl border border-zinc-200 bg-white" />
          <div className="h-24 animate-pulse rounded-2xl border border-zinc-200 bg-white" />
        </section>
      ) : pageError ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 text-center">
          <h1 className="text-xl font-semibold text-zinc-900">Wishlist unavailable</h1>
          <p className="mt-2 text-sm text-zinc-600">This shared wishlist could not be loaded.</p>
          <p className="mt-1 text-xs text-zinc-500">{pageError}</p>
          <button
            className="mt-4 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800"
            onClick={() => window.location.reload()}
            type="button"
          >
            Retry
          </button>
        </section>
      ) : model ? (
        <>
          <header className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{model.wishlist.title}</h1>
                <p className="mt-1 text-sm text-zinc-600">
                  Occasion: {formatDate(model.wishlist.occasionDate)} • {model.wishlist.itemCount} active items
                </p>
                {model.wishlist.occasionNote ? (
                  <p className="mt-2 text-sm text-zinc-700">{model.wishlist.occasionNote}</p>
                ) : null}
              </div>
              <Link className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800" href="/login">
                Sign in for actions
              </Link>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <label className="text-sm">
                <span className="mb-1 block font-medium text-zinc-800">Search</span>
                <input
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search items"
                  value={search}
                />
              </label>

              <label className="text-sm">
                <span className="mb-1 block font-medium text-zinc-800">Availability</span>
                <select
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                  onChange={(event) => setAvailabilityFilter(event.target.value as "all" | "available" | "reserved")}
                  value={availabilityFilter}
                >
                  <option value="all">All</option>
                  <option value="available">Available</option>
                  <option value="reserved">Reserved</option>
                </select>
              </label>

              <label className="text-sm">
                <span className="mb-1 block font-medium text-zinc-800">Funding</span>
                <select
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                  onChange={(event) => setFundingFilter(event.target.value as "all" | "group" | "single")}
                  value={fundingFilter}
                >
                  <option value="all">All items</option>
                  <option value="group">Group funded</option>
                  <option value="single">Single gift</option>
                </select>
              </label>
            </div>
          </header>

          <section className="mt-6 space-y-3">
            {filteredItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-600">
                No matching items right now.
              </div>
            ) : (
              filteredItems.map((item) => {
                const progressPercent = Math.max(0, Math.min(100, Math.round(item.progressRatio * 100)));
                const authHref = buildAuthReturnTo(shareToken, item.id);

                return (
                  <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm" key={item.id}>
                    <div className="flex flex-wrap gap-3">
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt={`${item.title} image`} className="h-full w-full object-cover" src={item.imageUrl} />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[11px] text-zinc-500">No image</div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h2 className="text-base font-semibold text-zinc-900">{item.title}</h2>
                            <p className="mt-1 text-xs text-zinc-600">
                              {formatMoney(item.priceCents, model.wishlist.currency)}
                              {item.url ? ` • ${item.url}` : ""}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                              item.availability === "available"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-100 text-amber-900"
                            }`}
                          >
                            {item.availability === "available" ? "Available" : "Reserved"}
                          </span>
                        </div>

                        {item.isGroupFunded ? (
                          <div className="mt-3">
                            <div className="flex items-center justify-between text-xs text-zinc-600">
                              <span>Funding progress</span>
                              <span>
                                {formatMoney(item.fundedCents, model.wishlist.currency)} / {formatMoney(item.targetCents, model.wishlist.currency)}
                              </span>
                            </div>
                            <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100">
                              <div className="h-full rounded-full bg-zinc-800" style={{ width: `${progressPercent}%` }} />
                            </div>
                          </div>
                        ) : null}

                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link
                            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800"
                            href={authHref}
                          >
                            Reserve
                          </Link>
                          {item.isGroupFunded ? (
                            <Link className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white" href={authHref}>
                              Contribute
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
