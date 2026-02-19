"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { getAuthenticatedEmail, persistReturnTo } from "@/app/_lib/auth-client";
import type { ItemRecord } from "@/app/_lib/item-store";

type ItemFormValues = {
  title: string;
  url: string;
  price: string;
  imageUrl: string;
  isGroupFunded: boolean;
  target: string;
};

type ItemFieldErrors = Partial<Record<"title" | "url" | "priceCents" | "imageUrl" | "targetCents", string>>;

type ItemApiResponse =
  | {
      ok: true;
      item: ItemRecord;
      warning?: "DUPLICATE_URL" | null;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        fieldErrors?: ItemFieldErrors;
      };
    };

const EMPTY_FORM: ItemFormValues = {
  title: "",
  url: "",
  price: "",
  imageUrl: "",
  isGroupFunded: false,
  target: "",
};

function centsToDisplay(cents: number | null) {
  if (cents === null) return "";
  return (cents / 100).toFixed(2);
}

function parseMoneyToCents(value: string): number | null {
  if (!value.trim()) return null;
  const normalized = value.replace(/,/g, "").trim();
  const asNumber = Number(normalized);
  if (!Number.isFinite(asNumber)) return Number.NaN;
  return Math.round(asNumber * 100);
}

function buildPayload(wishlistId: string, form: ItemFormValues) {
  const priceCents = parseMoneyToCents(form.price);
  const targetCents = parseMoneyToCents(form.target);

  return {
    wishlistId,
    title: form.title.trim(),
    url: form.url.trim() || null,
    priceCents,
    imageUrl: form.imageUrl.trim() || null,
    isGroupFunded: form.isGroupFunded,
    targetCents,
  };
}

export default function WishlistEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const wishlistId = params.id;

  const [items, setItems] = useState<ItemRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [form, setForm] = useState<ItemFormValues>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<ItemFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [metadataMessage, setMetadataMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);

  const activeItems = useMemo(() => items.filter((item) => !item.archivedAt), [items]);
  const archivedItems = useMemo(() => items.filter((item) => Boolean(item.archivedAt)), [items]);

  const duplicateUrlWarning = useMemo(() => {
    const normalized = form.url.trim().toLowerCase();
    if (!normalized) return false;
    return activeItems.some((item) => {
      if (!item.url) return false;
      if (editingItemId && item.id === editingItemId) return false;
      return item.url.toLowerCase() === normalized;
    });
  }, [activeItems, editingItemId, form.url]);

  useEffect(() => {
    let cancelled = false;

    async function loadItems() {
      const ownerEmail = getAuthenticatedEmail();
      if (!ownerEmail) {
        persistReturnTo(`/wishlists/${wishlistId}`);
        router.replace(`/login?returnTo=${encodeURIComponent(`/wishlists/${wishlistId}`)}`);
        return;
      }

      setIsLoading(true);
      setLoadError(null);

      try {
        const response = await fetch(`/api/items?wishlistId=${encodeURIComponent(wishlistId)}`, {
          headers: {
            "x-owner-email": ownerEmail,
          },
        });

        const payload = (await response.json()) as
          | { ok: true; items: ItemRecord[] }
          | { ok: false; error: { code: string; message: string } };

        if (cancelled) return;

        if (!response.ok || !payload.ok) {
          const message = payload && !payload.ok ? payload.error.message : "Unable to load items.";
          setLoadError(message);
          setItems([]);
          return;
        }

        setItems(payload.items);
      } catch {
        if (!cancelled) {
          setLoadError("Unable to load items. Please retry.");
          setItems([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadItems();

    return () => {
      cancelled = true;
    };
  }, [router, wishlistId]);

  function resetForm() {
    setEditingItemId(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
    setFormSuccess(null);
    setMetadataMessage(null);
  }

  function startEdit(item: ItemRecord) {
    setEditingItemId(item.id);
    setForm({
      title: item.title,
      url: item.url || "",
      price: centsToDisplay(item.priceCents),
      imageUrl: item.imageUrl || "",
      isGroupFunded: item.isGroupFunded,
      target: centsToDisplay(item.targetCents),
    });
    setFieldErrors({});
    setFormError(null);
    setFormSuccess(null);
    setMetadataMessage(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function applyServerFieldErrors(errors?: ItemFieldErrors) {
    setFieldErrors(errors || {});
  }

  function onToggleGroupFunded(checked: boolean) {
    setForm((prev) => {
      if (!checked) {
        return { ...prev, isGroupFunded: false, target: "" };
      }

      return {
        ...prev,
        isGroupFunded: true,
        target: prev.target || prev.price,
      };
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setMetadataMessage(null);
    setFieldErrors({});

    const ownerEmail = getAuthenticatedEmail();
    if (!ownerEmail) {
      persistReturnTo(`/wishlists/${wishlistId}`);
      router.replace(`/login?returnTo=${encodeURIComponent(`/wishlists/${wishlistId}`)}`);
      return;
    }

    const payload = buildPayload(wishlistId, form);

    if (!payload.title) {
      setFieldErrors({ title: "Item title is required." });
      return;
    }

    if (Number.isNaN(payload.priceCents)) {
      setFieldErrors({ priceCents: "Price must be a valid decimal amount." });
      return;
    }

    if (payload.isGroupFunded && Number.isNaN(payload.targetCents)) {
      setFieldErrors({ targetCents: "Target must be a valid decimal amount." });
      return;
    }

    setIsSubmitting(true);

    const endpoint = editingItemId ? `/api/items/${editingItemId}` : "/api/items";
    const method = editingItemId ? "PATCH" : "POST";

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method,
        headers: {
          "content-type": "application/json",
          "x-owner-email": ownerEmail,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      setIsSubmitting(false);
      setFormError("Unable to save item right now. Please retry.");
      return;
    }

    const result = (await response.json()) as ItemApiResponse;
    setIsSubmitting(false);

    if (!response.ok || !result.ok) {
      const message = result && !result.ok ? result.error.message : "Unable to save item right now.";
      setFormError(message);
      if (result && !result.ok) {
        applyServerFieldErrors(result.error.fieldErrors);
      }
      return;
    }

    setItems((current) => {
      if (editingItemId) {
        return current.map((item) => (item.id === result.item.id ? result.item : item));
      }
      return [result.item, ...current];
    });

    if (result.warning === "DUPLICATE_URL") {
      setFormSuccess("Saved. Duplicate URL detected in this wishlist.");
    } else {
      setFormSuccess(editingItemId ? "Item updated." : "Item created.");
    }

    if (!editingItemId) {
      setForm(EMPTY_FORM);
    }
  }

  async function onArchive(itemId: string) {
    const ownerEmail = getAuthenticatedEmail();
    if (!ownerEmail) {
      persistReturnTo(`/wishlists/${wishlistId}`);
      router.replace(`/login?returnTo=${encodeURIComponent(`/wishlists/${wishlistId}`)}`);
      return;
    }

    const response = await fetch(`/api/items/${itemId}/archive`, {
      method: "POST",
      headers: {
        "x-owner-email": ownerEmail,
      },
    });

    const payload = (await response.json()) as ItemApiResponse;

    if (!response.ok || !payload.ok) {
      const message = payload && !payload.ok ? payload.error.message : "Unable to archive item.";
      setFormError(message);
      return;
    }

    setItems((current) => current.map((item) => (item.id === payload.item.id ? payload.item : item)));
    setFormSuccess("Item archived.");
  }

  async function onAutofillFromUrl() {
    setMetadataMessage(null);

    const ownerEmail = getAuthenticatedEmail();
    if (!ownerEmail) {
      persistReturnTo(`/wishlists/${wishlistId}`);
      router.replace(`/login?returnTo=${encodeURIComponent(`/wishlists/${wishlistId}`)}`);
      return;
    }

    if (!form.url.trim()) {
      setMetadataMessage("Enter a URL before autofill.");
      return;
    }

    setIsFetchingMetadata(true);

    let response: Response;
    try {
      response = await fetch("/api/items/metadata", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-owner-email": ownerEmail,
        },
        body: JSON.stringify({ url: form.url.trim() }),
      });
    } catch {
      setIsFetchingMetadata(false);
      setMetadataMessage("Unable to fetch metadata right now. Continue with manual entry.");
      return;
    }

    const payload = (await response.json()) as
      | {
          ok: true;
          metadata: {
            title: string | null;
            imageUrl: string | null;
            priceCents: number | null;
          };
        }
      | {
          ok: false;
          error: {
            message: string;
          };
        };

    setIsFetchingMetadata(false);

    if (!response.ok || !payload.ok) {
      const message = payload && !payload.ok ? payload.error.message : "Metadata fetch failed.";
      setMetadataMessage(`${message} Continue with manual entry.`);
      return;
    }

    setForm((prev) => {
      const priceFromMeta = payload.metadata.priceCents !== null ? centsToDisplay(payload.metadata.priceCents) : prev.price;
      const nextTarget = prev.isGroupFunded ? prev.target || priceFromMeta : prev.target;

      return {
        ...prev,
        title: payload.metadata.title || prev.title,
        imageUrl: payload.metadata.imageUrl || prev.imageUrl,
        price: priceFromMeta,
        target: nextTarget,
      };
    });

    setMetadataMessage("Autofill complete. Review fields before saving.");
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Wishlist editor</h1>
          <p className="mt-1 text-sm text-zinc-600">Manage item details and archive items after activity.</p>
        </div>
        <Link className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800" href="/wishlists">
          Back to My wishlists
        </Link>
      </header>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <aside className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{editingItemId ? "Edit item" : "Add item"}</h2>
            {editingItemId ? (
              <button className="text-sm font-medium text-zinc-700 underline" onClick={resetForm} type="button">
                Cancel edit
              </button>
            ) : null}
          </div>

          <form className="mt-4 space-y-4" onSubmit={onSubmit} noValidate>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-800" htmlFor="item-title">
                Item title
              </label>
              <input
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                id="item-title"
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                value={form.title}
              />
              {fieldErrors.title ? <p className="mt-1 text-xs text-rose-700">{fieldErrors.title}</p> : null}
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-sm font-medium text-zinc-800" htmlFor="item-url">
                  Product URL
                </label>
                <button
                  className="text-xs font-medium text-zinc-700 underline"
                  disabled={isFetchingMetadata}
                  onClick={onAutofillFromUrl}
                  type="button"
                >
                  {isFetchingMetadata ? "Autofilling..." : "Autofill from URL"}
                </button>
              </div>
              <input
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                id="item-url"
                onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))}
                value={form.url}
              />
              {fieldErrors.url ? <p className="mt-1 text-xs text-rose-700">{fieldErrors.url}</p> : null}
              {duplicateUrlWarning ? (
                <p className="mt-1 text-xs text-amber-700">Duplicate URL detected in this wishlist. You can still save.</p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-800" htmlFor="item-price">
                  Price (USD)
                </label>
                <input
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                  id="item-price"
                  onChange={(event) =>
                    setForm((prev) => {
                      const nextPrice = event.target.value;
                      const nextTarget = prev.isGroupFunded && !prev.target ? nextPrice : prev.target;
                      return { ...prev, price: nextPrice, target: nextTarget };
                    })
                  }
                  placeholder="129.99"
                  value={form.price}
                />
                {fieldErrors.priceCents ? <p className="mt-1 text-xs text-rose-700">{fieldErrors.priceCents}</p> : null}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-800" htmlFor="item-image-url">
                  Image URL
                </label>
                <input
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                  id="item-image-url"
                  onChange={(event) => setForm((prev) => ({ ...prev, imageUrl: event.target.value }))}
                  value={form.imageUrl}
                />
                {fieldErrors.imageUrl ? <p className="mt-1 text-xs text-rose-700">{fieldErrors.imageUrl}</p> : null}
              </div>
            </div>

            <label className="flex items-center gap-2 rounded-lg border border-zinc-200 p-3 text-sm text-zinc-800">
              <input
                checked={form.isGroupFunded}
                onChange={(event) => onToggleGroupFunded(event.target.checked)}
                type="checkbox"
              />
              <span>Group funded item</span>
            </label>

            {form.isGroupFunded ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-800" htmlFor="item-target">
                  Funding target (USD)
                </label>
                <input
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                  id="item-target"
                  onChange={(event) => setForm((prev) => ({ ...prev, target: event.target.value }))}
                  placeholder="150.00"
                  value={form.target}
                />
                {fieldErrors.targetCents ? <p className="mt-1 text-xs text-rose-700">{fieldErrors.targetCents}</p> : null}
              </div>
            ) : null}

            {metadataMessage ? <p className="text-xs text-zinc-600">{metadataMessage}</p> : null}
            {formError ? <p className="text-sm text-rose-700">{formError}</p> : null}
            {formSuccess ? <p className="text-sm text-emerald-700">{formSuccess}</p> : null}

            <button
              className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Saving..." : editingItemId ? "Save item" : "Add item"}
            </button>
          </form>
        </aside>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Items</h2>

          {isLoading ? (
            <>
              <div className="h-24 animate-pulse rounded-xl border border-zinc-200 bg-white" />
              <div className="h-24 animate-pulse rounded-xl border border-zinc-200 bg-white" />
            </>
          ) : loadError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{loadError}</div>
          ) : activeItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-600">
              No items yet. Add your first item from the form.
            </div>
          ) : (
            activeItems.map((item) => (
              <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm" key={item.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-zinc-900">{item.title}</h3>
                    <p className="mt-1 text-xs text-zinc-600">
                      {item.url ? item.url : "No product URL"} • {item.priceCents !== null ? `$${(item.priceCents / 100).toFixed(2)}` : "No price"}
                    </p>
                    {item.isGroupFunded ? (
                      <p className="mt-1 text-xs text-zinc-600">
                        Group-funded target: {item.targetCents !== null ? `$${(item.targetCents / 100).toFixed(2)}` : "Unset"}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex gap-2">
                    <button
                      className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800"
                      onClick={() => startEdit(item)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-md border border-rose-300 px-3 py-2 text-sm font-medium text-rose-800"
                      onClick={() => onArchive(item.id)}
                      type="button"
                    >
                      Archive
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}

          {archivedItems.length > 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <h3 className="text-sm font-semibold text-zinc-900">Archived items</h3>
              <ul className="mt-2 space-y-2 text-sm text-zinc-700">
                {archivedItems.map((item) => (
                  <li key={item.id}>{item.title}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
