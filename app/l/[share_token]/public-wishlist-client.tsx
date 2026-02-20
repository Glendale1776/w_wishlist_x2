"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getAuthenticatedEmail, persistReturnTo } from "@/app/_lib/auth-client";

type ApiErrorResponse = {
  ok: false;
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string>;
    retryAfterSec?: number;
  };
};

type PublicItem = {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  isGroupFunded: boolean;
  targetCents: number | null;
  fundedCents: number;
  contributorCount: number;
  progressRatio: number;
  availability: "available" | "reserved";
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
      items: PublicItem[];
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
      items: PublicItem[];
    }
  | {
      type: "heartbeat";
      version: string;
    }
  | {
      type: "not_found";
    };

type ReservationActionResponse =
  | {
      ok: true;
      reservation: {
        status: "active" | "released";
      };
      item: PublicItem;
    }
  | ApiErrorResponse;

type ContributionActionResponse =
  | {
      ok: true;
      contribution: {
        id: string;
        amountCents: number;
        createdAt: string;
      };
      item: PublicItem;
    }
  | ApiErrorResponse;

type ArchiveAlertResponse =
  | {
      ok: true;
      alert: {
        id: string;
        archivedItemTitle: string;
        archivedItemPriceCents: number | null;
        suggestedItemIds: string[];
        createdAt: string;
      } | null;
    }
  | ApiErrorResponse;

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
  return `/l/${shareToken}?item=${encodeURIComponent(itemId)}`;
}

function parseContributionToCents(value: string): number {
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) return Number.NaN;
  const asNumber = Number(normalized);
  if (!Number.isFinite(asNumber)) return Number.NaN;
  return Math.round(asNumber * 100);
}

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function PublicWishlistClient({ shareToken }: { shareToken: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [model, setModel] = useState<PublicWishlistModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");

  const [search, setSearch] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<"all" | "available" | "reserved">("all");
  const [fundingFilter, setFundingFilter] = useState<"all" | "group" | "single">("all");
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [contributionInput, setContributionInput] = useState("");
  const [isMutating, setIsMutating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [reserveConfirmation, setReserveConfirmation] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [archiveAlert, setArchiveAlert] = useState<Extract<ArchiveAlertResponse, { ok: true }>["alert"]>(null);
  const [suggestedItemIds, setSuggestedItemIds] = useState<string[]>([]);
  const [isDismissingArchiveAlert, setIsDismissingArchiveAlert] = useState(false);
  const trackedOpenKeyRef = useRef<string | null>(null);
  const trackedArchiveAlertVersionRef = useRef<string | null>(null);

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

  const updateItemInModel = useCallback((nextItem: PublicItem) => {
    setModel((current) => {
      if (!current) return current;

      return {
        ...current,
        items: current.items.map((item) => (item.id === nextItem.id ? nextItem : item)),
      };
    });
  }, []);

  const redirectToLoginForItem = useCallback(
    (itemId: string) => {
      const returnTo = buildAuthReturnTo(shareToken, itemId);
      persistReturnTo(returnTo);
      router.push(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    },
    [router, shareToken],
  );

  useEffect(() => {
    let cancelled = false;

    async function hydrateAuth() {
      const email = await getAuthenticatedEmail();
      if (!cancelled) setAuthEmail(email);
    }

    void hydrateAuth();

    return () => {
      cancelled = true;
    };
  }, [activeItemId, shareToken]);

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

  useEffect(() => {
    if (!model) return;
    if (activeItemId) return;

    const fromQuery = searchParams.get("item")?.trim() || "";
    if (!fromQuery) return;

    const exists = model.items.some((item) => item.id === fromQuery);
    if (exists) {
      setActiveItemId(fromQuery);
    }
  }, [activeItemId, model, searchParams]);

  useEffect(() => {
    if (!model || !authEmail) return;

    const key = `${model.wishlist.id}:${authEmail}`;
    if (trackedOpenKeyRef.current === key) return;
    trackedOpenKeyRef.current = key;

    void fetch(`/api/public/${encodeURIComponent(shareToken)}/opened`, {
      method: "POST",
      headers: {
        "x-actor-email": authEmail,
      },
    }).catch(() => undefined);
  }, [authEmail, model, shareToken]);

  useEffect(() => {
    if (!model || !authEmail) return;

    const key = `${model.version}:${authEmail}`;
    if (trackedArchiveAlertVersionRef.current === key) return;
    trackedArchiveAlertVersionRef.current = key;

    void (async () => {
      try {
        const response = await fetch(`/api/public/${encodeURIComponent(shareToken)}/archive-alert`, {
          headers: {
            "x-actor-email": authEmail,
          },
        });
        const payload = (await response.json()) as ArchiveAlertResponse;
        if (!response.ok || !payload.ok || !payload.alert) return;

        setArchiveAlert(payload.alert);
        setSuggestedItemIds(payload.alert.suggestedItemIds || []);
      } catch {
        // Ignore alert fetch errors.
      }
    })();
  }, [authEmail, model, shareToken]);

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

  const suggestedOrder = useMemo(() => {
    const order = new Map<string, number>();
    suggestedItemIds.forEach((id, index) => order.set(id, index));
    return order;
  }, [suggestedItemIds]);

  const prioritizedItems = useMemo(() => {
    if (filteredItems.length <= 1 || suggestedOrder.size === 0) return filteredItems;
    return [...filteredItems].sort((left, right) => {
      const leftRank = suggestedOrder.has(left.id) ? suggestedOrder.get(left.id)! : Number.MAX_SAFE_INTEGER;
      const rightRank = suggestedOrder.has(right.id) ? suggestedOrder.get(right.id)! : Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return 0;
    });
  }, [filteredItems, suggestedOrder]);

  const reservedStats = useMemo(() => {
    if (!model) return { reserved: 0, total: 0 };
    const total = model.items.length;
    const reserved = model.items.reduce(
      (count, item) => (item.availability === "reserved" ? count + 1 : count),
      0,
    );
    return { reserved, total };
  }, [model]);

  const activeItem = useMemo(() => {
    if (!model || !activeItemId) return null;
    return model.items.find((item) => item.id === activeItemId) || null;
  }, [activeItemId, model]);

  const hasActiveFilters = Boolean(search.trim()) || availabilityFilter !== "all" || fundingFilter !== "all";
  const activeFilterCount =
    (search.trim() ? 1 : 0) + (availabilityFilter !== "all" ? 1 : 0) + (fundingFilter !== "all" ? 1 : 0);

  async function reserveAction(action: "reserve" | "unreserve") {
    if (!activeItem) return;

    const actorEmail = await getAuthenticatedEmail();
    if (!actorEmail) {
      setAuthEmail(null);
      redirectToLoginForItem(activeItem.id);
      return;
    }
    setAuthEmail(actorEmail);

    setIsMutating(true);
    setActionError(null);
    setActionSuccess(null);

    let response: Response;
    try {
      response = await fetch(`/api/public/${encodeURIComponent(shareToken)}/reservations`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-actor-email": actorEmail,
          "x-idempotency-key": createIdempotencyKey(),
        },
        body: JSON.stringify({
          itemId: activeItem.id,
          action,
        }),
      });
    } catch {
      setIsMutating(false);
      setActionError("Unable to complete this action. Please retry.");
      return;
    }

    const payload = (await response.json()) as ReservationActionResponse;
    setIsMutating(false);

    if (!response.ok || !payload.ok) {
      const message = payload && !payload.ok ? payload.error.message : "Unable to complete this action.";
      setActionError(message);
      return;
    }

    updateItemInModel(payload.item);
    if (action === "reserve") {
      closeModal();
      setReserveConfirmation("Item reserved.");
      return;
    }

    setActionSuccess("Reservation released.");
  }

  async function contributeAction() {
    if (!activeItem) return;

    const actorEmail = await getAuthenticatedEmail();
    if (!actorEmail) {
      setAuthEmail(null);
      redirectToLoginForItem(activeItem.id);
      return;
    }
    setAuthEmail(actorEmail);

    const amountCents = parseContributionToCents(contributionInput);
    if (!Number.isInteger(amountCents) || amountCents < 100) {
      setActionError("Contribution must be at least 1.00.");
      return;
    }

    setIsMutating(true);
    setActionError(null);
    setActionSuccess(null);

    let response: Response;
    try {
      response = await fetch(`/api/public/${encodeURIComponent(shareToken)}/contributions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-actor-email": actorEmail,
          "x-idempotency-key": createIdempotencyKey(),
        },
        body: JSON.stringify({
          itemId: activeItem.id,
          amountCents,
        }),
      });
    } catch {
      setIsMutating(false);
      setActionError("Unable to submit contribution. Please retry.");
      return;
    }

    const payload = (await response.json()) as ContributionActionResponse;
    setIsMutating(false);

    if (!response.ok || !payload.ok) {
      const message = payload && !payload.ok ? payload.error.message : "Unable to submit contribution.";
      setActionError(message);
      return;
    }

    updateItemInModel(payload.item);
    closeModal();
    setReserveConfirmation("Contribution saved.");
  }

  async function dismissArchiveAlert() {
    if (!archiveAlert || !authEmail) {
      setArchiveAlert(null);
      return;
    }

    setIsDismissingArchiveAlert(true);

    try {
      await fetch(`/api/public/${encodeURIComponent(shareToken)}/archive-alert`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-actor-email": authEmail,
        },
        body: JSON.stringify({
          notificationId: archiveAlert.id,
        }),
      });
    } catch {
      // Ignore dismiss failures. UI still closes for this session.
    } finally {
      setIsDismissingArchiveAlert(false);
      setArchiveAlert(null);
    }
  }

  const openModal = useCallback((itemId: string) => {
    setActiveItemId(itemId);
    setActionError(null);
    setActionSuccess(null);
    setContributionInput("");
  }, []);

  const closeModal = useCallback(() => {
    setActiveItemId(null);
    setActionError(null);
    setActionSuccess(null);
    setContributionInput("");
    const params = new URLSearchParams(searchParams.toString());
    if (!params.has("item")) return;
    params.delete("item");
    const nextQuery = params.toString();
    const nextPath = `/l/${encodeURIComponent(shareToken)}${nextQuery ? `?${nextQuery}` : ""}`;
    router.replace(nextPath);
  }, [router, searchParams, shareToken]);

  useEffect(() => {
    if (!activeItemId) return;

    function onWindowKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeModal();
    }

    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [activeItemId, closeModal]);

  useEffect(() => {
    if (!isFilterOpen) return;

    function onWindowKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsFilterOpen(false);
    }

    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [isFilterOpen]);

  useEffect(() => {
    if (!reserveConfirmation) return;

    const timer = window.setTimeout(() => {
      setReserveConfirmation(null);
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [reserveConfirmation]);

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      {reserveConfirmation ? (
        <div className="pointer-events-none fixed inset-x-0 top-5 z-[60] flex justify-center px-4">
          <div className="reserve-confirmation rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow-lg">
            {reserveConfirmation}
          </div>
        </div>
      ) : null}

      {archiveAlert ? (
        <div className="fixed inset-x-0 top-5 z-[61] flex justify-center px-4">
          <div className="w-full max-w-xl rounded-2xl border border-amber-300 bg-gradient-to-r from-amber-50 via-white to-sky-50 px-4 py-3 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-amber-900">Reserved item was archived</p>
                <p className="mt-1 text-xs text-zinc-700">
                  "{archiveAlert.archivedItemTitle}"{" "}
                  {archiveAlert.archivedItemPriceCents !== null
                    ? `(${formatMoney(archiveAlert.archivedItemPriceCents, model?.wishlist.currency || "USD")})`
                    : ""}
                  . Suggested similar-price items are highlighted at the top.
                </p>
              </div>
              <button
                className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-800"
                disabled={isDismissingArchiveAlert}
                onClick={() => void dismissArchiveAlert()}
                type="button"
              >
                {isDismissingArchiveAlert ? "Closing..." : "OK"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
          <header className="px-1 py-1 sm:px-2">
            <div className="overflow-hidden rounded-2xl bg-gradient-to-r from-sky-50 via-white to-rose-50 px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{model.wishlist.title}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-white/90 px-2.5 py-1 font-medium text-zinc-700 ring-1 ring-sky-100">
                      Occasion: {formatDate(model.wishlist.occasionDate)}
                    </span>
                    <span className="rounded-full bg-white/90 px-2.5 py-1 font-medium text-zinc-700 ring-1 ring-sky-100">
                      {model.wishlist.itemCount} active items
                    </span>
                    <span className="rounded-full bg-white/90 px-2.5 py-1 font-medium text-zinc-700 ring-1 ring-sky-100">
                      {reservedStats.reserved} of {reservedStats.total} reserved
                    </span>
                  </div>
                  {model.wishlist.occasionNote ? (
                    <p className="mt-3 max-w-3xl text-sm text-zinc-700">{model.wishlist.occasionNote}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    className="rounded-full border border-sky-200 bg-white/90 px-4 py-2 text-sm font-medium text-sky-900 transition hover:bg-white"
                    href="/me/activity"
                  >
                    My activity
                  </Link>
                  {!authEmail ? (
                    <Link
                      className="rounded-full border border-sky-200 bg-white/90 px-4 py-2 text-sm font-medium text-sky-900 transition hover:bg-white"
                      href="/login"
                    >
                      Sign in
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              {hasActiveFilters ? <span className="text-xs font-medium text-sky-800">Filters active</span> : null}
              <button
                className="rounded-full border border-sky-200 bg-white px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-sky-900 transition hover:bg-sky-50"
                onClick={() => setIsFilterOpen(true)}
                type="button"
              >
                Filters
              </button>
            </div>
          </header>

          <section className="mt-6 space-y-3">
            {prioritizedItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-600">
                No matching items right now.
              </div>
            ) : (
              prioritizedItems.map((item) => {
                const progressPercent = Math.max(0, Math.min(100, Math.round(item.progressRatio * 100)));
                const isSuggested = suggestedOrder.has(item.id);

                return (
                  <article
                    className={`rounded-xl border bg-white p-4 shadow-sm ${
                      isSuggested ? "border-sky-300 ring-1 ring-sky-200" : "border-zinc-200"
                    }`}
                    key={item.id}
                  >
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
                            {item.description ? <p className="mt-1 text-xs text-zinc-700">{item.description}</p> : null}
                            <p className="mt-1 text-xs text-zinc-600">
                              {formatMoney(item.priceCents, model.wishlist.currency)}
                              {item.url ? ` • ${item.url}` : ""}
                            </p>
                            {isSuggested ? (
                              <p className="mt-1 inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                                Suggested alternative
                              </p>
                            ) : null}
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
                                {formatMoney(item.fundedCents, model.wishlist.currency)} /{" "}
                                {formatMoney(item.targetCents, model.wishlist.currency)}
                              </span>
                            </div>
                            <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100">
                              <div className="h-full rounded-full bg-zinc-800" style={{ width: `${progressPercent}%` }} />
                            </div>
                          </div>
                        ) : null}

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800"
                            onClick={() => openModal(item.id)}
                            type="button"
                          >
                            {item.availability === "available" ? "Reserve" : "View actions"}
                          </button>
                          {item.isGroupFunded ? (
                            <button
                              className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white"
                              onClick={() => openModal(item.id)}
                              type="button"
                            >
                              Contribute
                            </button>
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

      {activeItem ? (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40 p-3 sm:items-center sm:justify-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-lg sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">{activeItem.title}</h2>
                {activeItem.description ? <p className="mt-1 text-xs text-zinc-700">{activeItem.description}</p> : null}
                <p className="mt-1 text-xs text-zinc-600">{formatMoney(activeItem.priceCents, model?.wishlist.currency || "USD")}</p>
              </div>
              <button className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-800" onClick={closeModal} type="button">
                Close
              </button>
            </div>

            <section className="mt-4 rounded-xl border border-zinc-200 p-3">
              <h3 className="text-sm font-semibold text-zinc-900">Reservation</h3>
              <p className="mt-1 text-xs text-zinc-600">
                Current status: {activeItem.availability === "available" ? "Available" : "Reserved"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 disabled:opacity-60"
                  disabled={isMutating}
                  onClick={() => reserveAction("reserve")}
                  type="button"
                >
                  Reserve
                </button>
                <button
                  className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 disabled:opacity-60"
                  disabled={isMutating}
                  onClick={() => reserveAction("unreserve")}
                  type="button"
                >
                  Release my reservation
                </button>
              </div>
            </section>

            <section className="mt-3 rounded-xl border border-zinc-200 p-3">
              <h3 className="text-sm font-semibold text-zinc-900">Contribution</h3>
              {activeItem.isGroupFunded ? (
                <>
                  <p className="mt-1 text-xs text-zinc-600">Enter amount in dollars (minimum 1.00).</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      className="w-32 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                      onChange={(event) => setContributionInput(event.target.value)}
                      placeholder="10.00"
                      value={contributionInput}
                    />
                    <button
                      className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                      disabled={isMutating}
                      onClick={contributeAction}
                      type="button"
                    >
                      Contribute
                    </button>
                  </div>
                </>
              ) : (
                <p className="mt-1 text-xs text-zinc-600">This item is not group funded.</p>
              )}
            </section>

            {actionError ? <p className="mt-3 text-sm text-rose-700">{actionError}</p> : null}
            {actionSuccess ? <p className="mt-3 text-sm text-emerald-700">{actionSuccess}</p> : null}

            {!authEmail ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Sign in to reserve or contribute. Your return to this item is preserved.
                <div className="mt-2">
                  <Link
                    className="rounded-md border border-amber-300 px-2.5 py-1.5 font-medium"
                    href={`/login?returnTo=${encodeURIComponent(buildAuthReturnTo(shareToken, activeItem.id))}`}
                  >
                    Sign in
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {isFilterOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-white/25 p-4 pt-16 backdrop-blur-[2px] sm:pt-20"
          onClick={(event) => {
            if (event.target === event.currentTarget) setIsFilterOpen(false);
          }}
        >
          <div className="filters-sheet w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-white/70 bg-[rgba(255,255,255,0.9)] shadow-[0_30px_80px_-35px_rgba(15,23,42,0.45)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-100/90 px-5 pb-4 pt-5 sm:px-6">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-700">Filters</h2>
                <p className="mt-1 text-xs text-zinc-500">Refine visible gifts quickly.</p>
              </div>
              {hasActiveFilters ? (
                <span className="rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">
                  {activeFilterCount} active
                </span>
              ) : null}
            </div>

            <div className="space-y-3 px-5 py-4 sm:px-6">
              <label className="block rounded-2xl border border-zinc-200/90 bg-white/85 p-3 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Search</span>
                <input
                  className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Type item name or keyword"
                  value={search}
                />
              </label>

              <label className="block rounded-2xl border border-zinc-200/90 bg-white/85 p-3 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Availability</span>
                <select
                  className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  onChange={(event) => setAvailabilityFilter(event.target.value as "all" | "available" | "reserved")}
                  value={availabilityFilter}
                >
                  <option value="all">All</option>
                  <option value="available">Available</option>
                  <option value="reserved">Reserved</option>
                </select>
              </label>

              <label className="block rounded-2xl border border-zinc-200/90 bg-white/85 p-3 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Funding</span>
                <select
                  className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  onChange={(event) => setFundingFilter(event.target.value as "all" | "group" | "single")}
                  value={fundingFilter}
                >
                  <option value="all">All items</option>
                  <option value="group">Group funded</option>
                  <option value="single">Single gift</option>
                </select>
              </label>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-zinc-100/90 bg-gradient-to-r from-zinc-50/85 to-white px-5 py-4 sm:px-6">
              <button
                className="rounded-full px-1 text-sm font-medium text-zinc-500 transition hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-45"
                disabled={!hasActiveFilters}
                onClick={() => {
                  setSearch("");
                  setAvailabilityFilter("all");
                  setFundingFilter("all");
                }}
                type="button"
              >
                Reset
              </button>
              <button
                className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                onClick={() => setIsFilterOpen(false)}
                type="button"
              >
                Close
              </button>
              <button
                className="rounded-full bg-gradient-to-r from-blue-600 to-sky-500 px-5 py-2 text-sm font-semibold text-white shadow-[0_8px_20px_-10px_rgba(30,64,175,0.7)] transition hover:brightness-105"
                onClick={() => setIsFilterOpen(false)}
                type="button"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <style jsx>{`
        .filters-sheet {
          animation: filters-sheet-in 180ms ease-out;
        }

        .reserve-confirmation {
          background-image: linear-gradient(120deg, #2563eb, #7c3aed, #ec4899, #2563eb);
          background-size: 220% 220%;
          animation:
            reserve-confirmation-in 180ms ease-out,
            reserve-confirmation-gradient 900ms linear infinite;
        }

        @keyframes filters-sheet-in {
          from {
            opacity: 0;
            transform: translateY(-8px) scale(0.985);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes reserve-confirmation-in {
          from {
            opacity: 0;
            transform: translateY(-8px) scale(0.97);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes reserve-confirmation-gradient {
          0% {
            background-position: 0% 50%;
          }
          100% {
            background-position: 100% 50%;
          }
        }
      `}</style>
    </main>
  );
}
