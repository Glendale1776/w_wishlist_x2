"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { getAuthenticatedEmail, getAuthenticatedOwnerHeaders, persistReturnTo } from "@/app/_lib/auth-client";
import type { ItemRecord } from "@/app/_lib/item-store";

type ItemFormValues = {
  description: string;
  url: string;
  imageUrls: string[];
  isGroupFunded: boolean;
  target: string;
};

type ItemFieldErrors = Partial<
  Record<
    "title" | "description" | "url" | "priceCents" | "imageUrl" | "imageUrls" | "targetCents" | "imageFile" | "draftText",
    string
  >
>;

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

type ImagePrepareResponse =
  | {
      ok: true;
      uploadUrl: string;
      expiresInSec: number;
      maxUploadMb: number;
      allowedMimeTypes: string[];
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        fieldErrors?: ItemFieldErrors;
      };
    };

type ImageUploadResponse =
  | {
      ok: true;
      item: ItemRecord;
      previewUrl: string | null;
      expiresInSec: number;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        fieldErrors?: ItemFieldErrors;
      };
    };

type ImagePreviewResponse =
  | {
      ok: true;
      previewUrl: string | null;
      expiresInSec: number | null;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

type DraftParseResponse =
  | {
      ok: true;
      parsed: {
        title: string | null;
        description: string | null;
        priceCents: number | null;
      };
      priceNeedsReview: boolean;
      priceReviewMessage: string | null;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        fieldErrors?: Record<string, string>;
      };
    };

type MetadataApiResponse =
  | {
      ok: true;
      metadata: {
        title: string | null;
        description: string | null;
        imageUrl: string | null;
        imageUrls?: string[] | null;
        priceCents: number | null;
        priceNeedsReview?: boolean;
        priceReviewMessage?: string | null;
      };
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

type WishlistsListResponse =
  | {
      ok: true;
      wishlists: Array<{
        id: string;
        shareUrlPreview: string;
      }>;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

type ItemAvailability = "available" | "reserved";

type OwnerRealtimeMessage =
  | {
      type: "snapshot";
      items: Array<{
        id: string;
        title: string;
        availability: ItemAvailability;
        fundedCents: number;
        contributorCount: number;
      }>;
    }
  | {
      type: "heartbeat";
    }
  | {
      type: "not_found";
    };

type ItemContributionSummary = {
  fundedCents: number;
  contributorCount: number;
};

type PendingImage = {
  id: string;
  file: File;
  previewUrl: string;
};

const EMPTY_FORM: ItemFormValues = {
  description: "",
  url: "",
  imageUrls: [],
  isGroupFunded: false,
  target: "",
};

const CLIENT_MAX_UPLOAD_MB = 10;
const CLIENT_MAX_UPLOAD_BYTES = CLIENT_MAX_UPLOAD_MB * 1024 * 1024;
const CLIENT_MAX_ITEM_IMAGES = 10;
const CLIENT_ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

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

type ParsedDraftFields = {
  title: string;
  description: string | null;
  priceCents: number | null;
};

function formatPriceCents(cents: number | null) {
  if (cents === null) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

function buildDraftEditorTextFromStructured(input: {
  title: string | null;
  description: string | null;
  priceCents: number | null;
}) {
  const lines: string[] = [];
  if (input.title && input.title.trim()) {
    lines.push(`Title: ${input.title.trim()}`);
  }
  if (input.priceCents !== null) {
    lines.push(`Price: ${formatPriceCents(input.priceCents)}`);
  }
  if (input.description && input.description.trim()) {
    lines.push("Description:");
    lines.push(input.description.trim());
  }
  return lines.join("\n");
}

function mergeDraftTextWithImported(input: {
  currentDraftText: string;
  importedTitle: string | null;
  importedDescription: string | null;
  importedPriceCents: number | null;
}) {
  const current = input.currentDraftText.trim();
  const imported = buildDraftEditorTextFromStructured({
    title: input.importedTitle,
    description: input.importedDescription,
    priceCents: input.importedPriceCents,
  });

  if (!current) return imported;
  if (!imported) return current;
  return `${current}\n\nImported from URL:\n${imported}`;
}

function buildPayload(wishlistId: string, form: ItemFormValues, parsedDraft: ParsedDraftFields) {
  const targetCents = parseMoneyToCents(form.target);
  const fallbackTargetCents =
    form.isGroupFunded && targetCents === null && parsedDraft.priceCents !== null ? parsedDraft.priceCents : targetCents;

  return {
    wishlistId,
    title: parsedDraft.title.trim(),
    description: parsedDraft.description,
    url: form.url.trim() || null,
    priceCents: parsedDraft.priceCents,
    imageUrls: form.imageUrls,
    isGroupFunded: form.isGroupFunded,
    targetCents: form.isGroupFunded ? fallbackTargetCents : null,
  };
}

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function extractShareTokenFromPreview(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const fallbackOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsed = new URL(trimmed, fallbackOrigin);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const tokenIndex = parts.findIndex((part) => part === "l");
    if (tokenIndex >= 0 && parts[tokenIndex + 1]) {
      return decodeURIComponent(parts[tokenIndex + 1]);
    }
    return parts.length > 0 ? decodeURIComponent(parts[parts.length - 1]) : null;
  } catch {
    const match = trimmed.match(/\/l\/([^/?#]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]);
    return null;
  }
}

function isStorageImageRef(value: string | null | undefined) {
  return Boolean(value && value.startsWith("storage://"));
}

function getItemImageUrls(item: Pick<ItemRecord, "imageUrl" | "imageUrls">): string[] {
  if (Array.isArray(item.imageUrls) && item.imageUrls.length > 0) {
    const normalized = item.imageUrls.filter(Boolean);
    if (normalized.length > 0) return normalized;
  }
  if (item.imageUrl) return [item.imageUrl];
  return [];
}

function uploadFileWithProgress(input: {
  uploadUrl: string;
  ownerEmail: string;
  file: File;
  onProgress: (value: number) => void;
}): Promise<ImageUploadResponse> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", input.uploadUrl);
    xhr.setRequestHeader("x-owner-email", input.ownerEmail);
    xhr.setRequestHeader("content-type", input.file.type);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      input.onProgress(Math.min(Math.max(percent, 0), 100));
    };

    xhr.onerror = () => {
      resolve({
        ok: false,
        error: {
          code: "NETWORK_ERROR",
          message: "Upload failed. Check your connection and retry.",
        },
      });
    };

    xhr.onload = () => {
      let payload: ImageUploadResponse | null = null;

      try {
        payload = JSON.parse(xhr.responseText) as ImageUploadResponse;
      } catch {
        payload = null;
      }

      if (payload) {
        resolve(payload);
        return;
      }

      resolve({
        ok: false,
        error: {
          code: "UPLOAD_FAILED",
          message: "Upload failed. Please retry.",
        },
      });
    };

    xhr.send(input.file);
  });
}

export default function WishlistEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const wishlistId = params.id;

  const [items, setItems] = useState<ItemRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shareUrlPreview, setShareUrlPreview] = useState<string | null>(null);
  const [shareLinkMessage, setShareLinkMessage] = useState<string | null>(null);
  const [shareLinkError, setShareLinkError] = useState<string | null>(null);
  const [isCopyLinkConfirmed, setIsCopyLinkConfirmed] = useState(false);
  const [availabilityByItemId, setAvailabilityByItemId] = useState<Record<string, ItemAvailability>>({});
  const [contributionByItemId, setContributionByItemId] = useState<Record<string, ItemContributionSummary>>({});
  const [reservationLiveNotice, setReservationLiveNotice] = useState<string | null>(null);

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [form, setForm] = useState<ItemFormValues>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<ItemFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [metadataMessage, setMetadataMessage] = useState<string | null>(null);
  const [priceReviewNotice, setPriceReviewNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRestoringItemId, setIsRestoringItemId] = useState<string | null>(null);

  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [imagePreviewByItemId, setImagePreviewByItemId] = useState<Record<string, string[]>>({});
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [imageMessage, setImageMessage] = useState<string | null>(null);
  const [reviewingItemId, setReviewingItemId] = useState<string | null>(null);
  const [reviewImageUrls, setReviewImageUrls] = useState<string[]>([]);
  const [reviewImageIndex, setReviewImageIndex] = useState(0);
  const [reviewImageError, setReviewImageError] = useState<string | null>(null);
  const [isLoadingReviewImages, setIsLoadingReviewImages] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImagesRef = useRef<PendingImage[]>([]);
  const reviewLoadTokenRef = useRef<string | null>(null);
  const availabilityByItemIdRef = useRef<Record<string, ItemAvailability>>({});
  const reservationNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyLinkFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeItems = useMemo(() => items.filter((item) => !item.archivedAt), [items]);
  const archivedItems = useMemo(() => items.filter((item) => Boolean(item.archivedAt)), [items]);
  const activeReservedCount = useMemo(
    () =>
      activeItems.reduce((count, item) => (availabilityByItemId[item.id] === "reserved" ? count + 1 : count), 0),
    [activeItems, availabilityByItemId],
  );
  const reviewingItem = useMemo(
    () => items.find((item) => item.id === reviewingItemId) || null,
    [items, reviewingItemId],
  );
  const reviewingContributionSummary = useMemo(() => {
    if (!reviewingItem) return null;
    return (
      contributionByItemId[reviewingItem.id] || {
        fundedCents: reviewingItem.fundedCents,
        contributorCount: reviewingItem.contributorCount,
      }
    );
  }, [contributionByItemId, reviewingItem]);

  const duplicateUrlWarning = useMemo(() => {
    const normalized = form.url.trim().toLowerCase();
    if (!normalized) return false;
    return activeItems.some((item) => {
      if (!item.url) return false;
      if (editingItemId && item.id === editingItemId) return false;
      return item.url.toLowerCase() === normalized;
    });
  }, [activeItems, editingItemId, form.url]);

  const activeEditPreviewUrl = useMemo(() => {
    const firstDraftImage = form.imageUrls[0] || null;
    if (pendingImages[0]?.previewUrl) return pendingImages[0].previewUrl;
    if (!editingItemId) return firstDraftImage;
    return imagePreviewByItemId[editingItemId]?.[0] || firstDraftImage;
  }, [editingItemId, form.imageUrls, imagePreviewByItemId, pendingImages]);

  const activeImageCount = form.imageUrls.length + pendingImages.length;
  const currentReviewImageUrl = reviewImageUrls[reviewImageIndex] || null;

  useEffect(() => {
    let cancelled = false;

    async function loadItems() {
      const ownerEmail = await getAuthenticatedEmail();
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
          setShareUrlPreview(null);
          return;
        }

        setItems(payload.items);

        try {
          const ownerHeaders = await getAuthenticatedOwnerHeaders();
          if (!ownerHeaders) {
            setShareUrlPreview(null);
            return;
          }

          const wishlistsResponse = await fetch("/api/wishlists", {
            headers: ownerHeaders,
          });

          const wishlistsPayload = (await wishlistsResponse.json()) as WishlistsListResponse;
          if (cancelled) return;

          if (!wishlistsResponse.ok || !wishlistsPayload.ok) {
            setShareUrlPreview(null);
            return;
          }

          const currentWishlist = wishlistsPayload.wishlists.find((wishlist) => wishlist.id === wishlistId);
          setShareUrlPreview(currentWishlist?.shareUrlPreview || null);
        } catch {
          if (!cancelled) {
            setShareUrlPreview(null);
          }
        }
      } catch {
        if (!cancelled) {
          setLoadError("Unable to load items. Please retry.");
          setItems([]);
          setShareUrlPreview(null);
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

  useEffect(() => {
    const shareToken = extractShareTokenFromPreview(shareUrlPreview);
    if (!shareToken) {
      availabilityByItemIdRef.current = {};
      setAvailabilityByItemId({});
      setContributionByItemId({});
      setReservationLiveNotice(null);
      return;
    }

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

      source = new EventSource(`/api/public/${encodeURIComponent(shareToken)}/stream`);

      source.onmessage = (event) => {
        if (cancelled) return;

        let message: OwnerRealtimeMessage;
        try {
          message = JSON.parse(event.data) as OwnerRealtimeMessage;
        } catch {
          return;
        }

        if (message.type !== "snapshot") return;

        const previous = availabilityByItemIdRef.current;
        const next: Record<string, ItemAvailability> = {};
        const nextContributions: Record<string, ItemContributionSummary> = {};
        let newlyReservedTitle: string | null = null;

        for (const item of message.items) {
          next[item.id] = item.availability;
          nextContributions[item.id] = {
            fundedCents: item.fundedCents,
            contributorCount: item.contributorCount,
          };
          if (item.availability === "reserved" && previous[item.id] !== "reserved" && !newlyReservedTitle) {
            newlyReservedTitle = item.title;
          }
        }

        availabilityByItemIdRef.current = next;
        setAvailabilityByItemId(next);
        setContributionByItemId(nextContributions);

        if (newlyReservedTitle) {
          setReservationLiveNotice(`Reserved now: ${newlyReservedTitle}`);
          if (reservationNoticeTimerRef.current) {
            clearTimeout(reservationNoticeTimerRef.current);
          }
          reservationNoticeTimerRef.current = setTimeout(() => {
            setReservationLiveNotice(null);
            reservationNoticeTimerRef.current = null;
          }, 2400);
        }
      };

      source.onerror = () => {
        if (cancelled) return;

        if (source) {
          source.close();
          source = null;
        }

        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 3000);
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      clearReconnect();
      if (source) source.close();
    };
  }, [shareUrlPreview]);

  useEffect(() => {
    return () => {
      if (reservationNoticeTimerRef.current) {
        clearTimeout(reservationNoticeTimerRef.current);
      }
      if (copyLinkFeedbackTimerRef.current) {
        clearTimeout(copyLinkFeedbackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydratePreviews() {
      const ownerEmail = await getAuthenticatedEmail();
      if (!ownerEmail || items.length === 0) {
        if (!cancelled) setImagePreviewByItemId({});
        return;
      }

      const next: Record<string, string[]> = {};

      await Promise.all(
        items.map(async (item) => {
          const imageRefs = getItemImageUrls(item);
          if (imageRefs.length === 0) return;
          const firstImageRef = imageRefs[0];

          if (!isStorageImageRef(firstImageRef)) {
            next[item.id] = [firstImageRef];
            return;
          }

          const previewUrl = await fetchSignedPreviewUrl({
            itemId: item.id,
            ownerEmail,
          });
          if (!previewUrl) return;
          next[item.id] = [previewUrl];
        }),
      );

      if (!cancelled) {
        setImagePreviewByItemId(next);
      }
    }

    hydratePreviews();

    return () => {
      cancelled = true;
    };
  }, [items]);

  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  useEffect(() => {
    return () => {
      pendingImagesRef.current.forEach((pendingImage) => {
        URL.revokeObjectURL(pendingImage.previewUrl);
      });
    };
  }, []);

  useEffect(() => {
    if (!reviewingItemId) return;

    function onWindowKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeItemReview();
      }
    }

    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [reviewingItemId]);

  useEffect(() => {
    if (reviewImageUrls.length === 0) {
      setReviewImageIndex(0);
      return;
    }
    setReviewImageIndex((current) => Math.min(current, reviewImageUrls.length - 1));
  }, [reviewImageUrls]);

  function clearPendingImages() {
    setPendingImages((current) => {
      current.forEach((pendingImage) => {
        URL.revokeObjectURL(pendingImage.previewUrl);
      });
      return [];
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function removePendingImage(id: string) {
    setPendingImages((current) => {
      const target = current.find((pendingImage) => pendingImage.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((pendingImage) => pendingImage.id !== id);
    });
  }

  function removeDraftImageAt(index: number) {
    setForm((current) => ({
      ...current,
      imageUrls: current.imageUrls.filter((_, imageIndex) => imageIndex !== index),
    }));
    setImageMessage(editingItemId ? "Image removed from draft. Save item to apply changes." : "Image removed from draft.");
    setFieldErrors((current) => ({ ...current, imageFile: undefined, imageUrls: undefined }));
  }

  function resetForm() {
    setEditingItemId(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
    setFormSuccess(null);
    setMetadataMessage(null);
    setPriceReviewNotice(null);
    setImageMessage(null);
    clearPendingImages();
    setUploadProgress(0);
  }

  async function fetchSignedPreviewUrl(input: {
    itemId: string;
    ownerEmail: string;
    imageIndex?: number;
  }): Promise<string | null> {
    async function requestPreview() {
      try {
        const response = await fetch(`/api/items/${input.itemId}/image-upload-url`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-owner-email": input.ownerEmail,
          },
          body: JSON.stringify({
            mode: "preview",
            ...(input.imageIndex !== undefined ? { imageIndex: input.imageIndex } : {}),
          }),
        });

        const payload = (await response.json()) as ImagePreviewResponse;
        if (!response.ok || !payload.ok || !payload.previewUrl) return null;
        return payload.previewUrl;
      } catch {
        return null;
      }
    }

    const firstAttempt = await requestPreview();
    if (firstAttempt) return firstAttempt;

    // Retry once to smooth transient signed URL failures.
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    return requestPreview();
  }

  async function hydratePreviewForItem(itemId: string, imageRefsOverride?: string[]) {
    const ownerEmail = await getAuthenticatedEmail();
    if (!ownerEmail) return;

    const fallbackItem = items.find((item) => item.id === itemId) || null;
    const imageRefs =
      imageRefsOverride && imageRefsOverride.length > 0
        ? imageRefsOverride
        : fallbackItem
          ? getItemImageUrls(fallbackItem)
          : [];

    if (imageRefs.length === 0) {
      setImagePreviewByItemId((current) => {
        const next = { ...current };
        delete next[itemId];
        return next;
      });
      return;
    }

    const previewUrls = await Promise.all(
      imageRefs.map(async (imageRef, imageIndex) => {
        if (!isStorageImageRef(imageRef)) return imageRef;
        const previewUrl = await fetchSignedPreviewUrl({
          itemId,
          ownerEmail,
          imageIndex,
        });
        return previewUrl || "";
      }),
    );
    const hasAtLeastOnePreview = previewUrls.some((value) => Boolean(value));

    setImagePreviewByItemId((current) => {
      const next = { ...current };
      if (hasAtLeastOnePreview) {
        next[itemId] = previewUrls;
      } else {
        delete next[itemId];
      }
      return next;
    });
  }

  function closeItemReview() {
    reviewLoadTokenRef.current = null;
    setReviewingItemId(null);
    setReviewImageUrls([]);
    setReviewImageError(null);
    setReviewImageIndex(0);
    setIsLoadingReviewImages(false);
  }

  async function openItemReview(item: ItemRecord) {
    const imageRefs = getItemImageUrls(item);
    const cachedFirstPreview = imagePreviewByItemId[item.id]?.[0] || null;
    const nextToken = createIdempotencyKey();
    reviewLoadTokenRef.current = nextToken;

    setReviewingItemId(item.id);
    setReviewImageError(null);
    setReviewImageIndex(0);
    setReviewImageUrls(cachedFirstPreview ? [cachedFirstPreview] : []);

    if (imageRefs.length === 0) {
      setReviewImageUrls([]);
      setIsLoadingReviewImages(false);
      return;
    }

    const ownerEmail = await getAuthenticatedEmail();
    if (!ownerEmail) {
      persistReturnTo(`/wishlists/${wishlistId}`);
      router.replace(`/login?returnTo=${encodeURIComponent(`/wishlists/${wishlistId}`)}`);
      closeItemReview();
      return;
    }

    setIsLoadingReviewImages(true);

    const resolved = await Promise.all(
      imageRefs.map(async (imageRef, imageIndex) => {
        if (!isStorageImageRef(imageRef)) return imageRef;

        const previewUrl = await fetchSignedPreviewUrl({
          itemId: item.id,
          ownerEmail,
          imageIndex,
        });
        if (previewUrl) return previewUrl;
        if (imageIndex === 0 && cachedFirstPreview) return cachedFirstPreview;
        return null;
      }),
    );

    if (reviewLoadTokenRef.current !== nextToken) {
      return;
    }

    const nextUrls = Array.from(new Set(resolved.filter((value): value is string => Boolean(value))));
    setReviewImageUrls(nextUrls);
    setIsLoadingReviewImages(false);

    if (nextUrls.length === 0) {
      setReviewImageError("No image previews available for this item.");
    }
  }

  function startEdit(item: ItemRecord) {
    const draftText = buildDraftEditorTextFromStructured({
      title: item.title,
      description: item.description || null,
      priceCents: item.priceCents,
    });

    setEditingItemId(item.id);
    setForm({
      description: draftText || item.description || "",
      url: item.url || "",
      imageUrls: getItemImageUrls(item),
      isGroupFunded: item.isGroupFunded,
      target: centsToDisplay(item.targetCents),
    });
    setFieldErrors({});
    setFormError(null);
    setFormSuccess(null);
    setMetadataMessage(null);
    setPriceReviewNotice(null);
    setImageMessage(null);
    clearPendingImages();
    setUploadProgress(0);

    const imageRefs = getItemImageUrls(item);
    if (imageRefs.length > 0) {
      void hydratePreviewForItem(item.id, imageRefs);
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function applyServerFieldErrors(errors?: ItemFieldErrors) {
    if (!errors) {
      setFieldErrors({});
      return;
    }

    const nextErrors: ItemFieldErrors = { ...errors };
    if (errors.title && !nextErrors.description) {
      nextErrors.description = errors.title;
    }
    if (errors.priceCents && !nextErrors.description) {
      nextErrors.description = errors.priceCents;
    }

    setFieldErrors(nextErrors);
  }

  function onToggleGroupFunded(checked: boolean) {
    setForm((prev) => {
      if (!checked) {
        return { ...prev, isGroupFunded: false, target: "" };
      }

      return {
        ...prev,
        isGroupFunded: true,
        target: prev.target,
      };
    });
  }

  async function parseDraftTextWithAi(ownerEmail: string, draftText: string): Promise<{
    parsed: ParsedDraftFields;
    priceNeedsReview: boolean;
    priceReviewMessage: string | null;
  } | null> {
    let response: Response;
    try {
      response = await fetch("/api/items/draft-parse", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-owner-email": ownerEmail,
        },
        body: JSON.stringify({
          draftText,
        }),
      });
    } catch {
      setFormError("Unable to parse item text right now. Please retry.");
      return null;
    }

    const payload = (await response.json()) as DraftParseResponse;
    if (!response.ok || !payload.ok) {
      const message = payload && !payload.ok ? payload.error.message : "Unable to parse item text.";
      setFormError(message);
      if (payload && !payload.ok && payload.error.fieldErrors?.draftText) {
        setFieldErrors((current) => ({ ...current, description: payload.error.fieldErrors?.draftText || undefined }));
      }
      return null;
    }

    const title = (payload.parsed.title || "").trim();
    if (!title) {
      setFieldErrors((current) => ({
        ...current,
        description: "Could not detect item title. Add a product name in the text.",
      }));
      return null;
    }

    return {
      parsed: {
        title,
        description: payload.parsed.description?.trim() || null,
        priceCents: payload.parsed.priceCents,
      },
      priceNeedsReview: payload.priceNeedsReview,
      priceReviewMessage: payload.priceReviewMessage,
    };
  }

  async function fetchMetadataForUrl(input: {
    ownerEmail: string;
    url: string;
    specNotes: string;
  }): Promise<{
    ok: true;
    metadata: Extract<MetadataApiResponse, { ok: true }>["metadata"];
    reviewNotice: string | null;
    importedImageCount: number;
  } | { ok: false; message: string }> {
    let response: Response;
    try {
      response = await fetch("/api/items/metadata", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-owner-email": input.ownerEmail,
        },
        body: JSON.stringify({
          url: input.url,
          specNotes: input.specNotes || null,
        }),
      });
    } catch {
      return {
        ok: false,
        message: "Unable to fetch metadata right now. Saved using your typed details only.",
      };
    }

    const payload = (await response.json()) as MetadataApiResponse;
    if (!response.ok || !payload.ok) {
      const message = payload && !payload.ok ? payload.error.message : "Metadata fetch failed.";
      return {
        ok: false,
        message: `${message} Saved using your typed details only.`,
      };
    }

    const needsPriceReview = Boolean(payload.metadata.priceNeedsReview) || payload.metadata.priceCents === null;
    const reviewMessage =
      payload.metadata.priceReviewMessage?.trim() ||
      (payload.metadata.priceCents === null
        ? "Price was not detected. Please verify before saving."
        : "Imported price may be inaccurate. Please verify before saving.");

    const importedImageCount = Array.isArray(payload.metadata.imageUrls)
      ? payload.metadata.imageUrls.filter((value) => (value || "").trim().length > 0).length
      : payload.metadata.imageUrl
        ? 1
        : 0;

    return {
      ok: true,
      metadata: payload.metadata,
      reviewNotice: needsPriceReview ? reviewMessage : null,
      importedImageCount,
    };
  }

  function onSelectImageFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setFieldErrors((current) => ({ ...current, imageFile: undefined }));
    setImageMessage(null);

    const allowedSlots = CLIENT_MAX_ITEM_IMAGES - (form.imageUrls.length + pendingImages.length);
    if (allowedSlots <= 0) {
      setFieldErrors((current) => ({
        ...current,
        imageFile: `Up to ${CLIENT_MAX_ITEM_IMAGES} images are allowed per item.`,
      }));
      event.target.value = "";
      return;
    }

    const selected: PendingImage[] = [];
    let hasValidationError = false;

    for (const file of files) {
      if (selected.length >= allowedSlots) {
        hasValidationError = true;
        break;
      }

      const normalizedMime = file.type.trim().toLowerCase();
      if (!CLIENT_ALLOWED_MIME_TYPES.has(normalizedMime)) {
        hasValidationError = true;
        continue;
      }

      if (file.size > CLIENT_MAX_UPLOAD_BYTES) {
        hasValidationError = true;
        continue;
      }

      selected.push({
        id: createIdempotencyKey(),
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    if (selected.length === 0) {
      setFieldErrors((current) => ({
        ...current,
        imageFile: hasValidationError
          ? `Add PNG, JPG, WEBP, or GIF images up to ${CLIENT_MAX_UPLOAD_MB} MB each. Maximum ${CLIENT_MAX_ITEM_IMAGES} images per item.`
          : "Select at least one image.",
      }));
      event.target.value = "";
      return;
    }

    setPendingImages((current) => [...current, ...selected]);
    if (hasValidationError) {
      setFieldErrors((current) => ({
        ...current,
        imageFile: `Some files were skipped. Use PNG, JPG, WEBP, or GIF up to ${CLIENT_MAX_UPLOAD_MB} MB. Max ${CLIENT_MAX_ITEM_IMAGES} images per item.`,
      }));
    }

    const imageWord = selected.length === 1 ? "image" : "images";
    setImageMessage(editingItemId ? `${selected.length} ${imageWord} selected. Save item to upload.` : `${selected.length} ${imageWord} selected. They will upload after item creation.`);
    event.target.value = "";
  }

  async function uploadImageForItem(itemId: string, file: File) {
    const ownerEmail = await getAuthenticatedEmail();
    if (!ownerEmail) {
      persistReturnTo(`/wishlists/${wishlistId}`);
      router.replace(`/login?returnTo=${encodeURIComponent(`/wishlists/${wishlistId}`)}`);
      return { ok: false as const };
    }

    setIsUploadingImage(true);
    setUploadProgress(5);
    setImageMessage(null);
    setFieldErrors((current) => ({ ...current, imageFile: undefined }));

    let prepareResponse: Response;
    try {
      prepareResponse = await fetch(`/api/items/${itemId}/image-upload-url`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-owner-email": ownerEmail,
        },
        body: JSON.stringify({
          mode: "prepare-upload",
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      });
    } catch {
      setIsUploadingImage(false);
      setUploadProgress(0);
      setImageMessage("Unable to prepare upload. Retry.");
      return { ok: false as const };
    }

    const preparePayload = (await prepareResponse.json()) as ImagePrepareResponse;
    if (!prepareResponse.ok || !preparePayload.ok) {
      setIsUploadingImage(false);
      setUploadProgress(0);
      setImageMessage(preparePayload && !preparePayload.ok ? preparePayload.error.message : "Unable to prepare upload.");
      if (preparePayload && !preparePayload.ok && preparePayload.error.fieldErrors) {
        applyServerFieldErrors(preparePayload.error.fieldErrors);
      }
      return { ok: false as const };
    }

    const uploadResult = await uploadFileWithProgress({
      uploadUrl: preparePayload.uploadUrl,
      ownerEmail,
      file,
      onProgress: (next) => setUploadProgress(next),
    });

    setIsUploadingImage(false);

    if (!uploadResult.ok) {
      setUploadProgress(0);
      setImageMessage(uploadResult.error.message || "Upload failed. Retry.");
      return { ok: false as const };
    }

    setItems((current) => current.map((item) => (item.id === uploadResult.item.id ? uploadResult.item : item)));
    setForm((current) => ({ ...current, imageUrls: getItemImageUrls(uploadResult.item) }));
    await hydratePreviewForItem(itemId, getItemImageUrls(uploadResult.item));
    setUploadProgress(100);
    setImageMessage("Image uploaded.");

    window.setTimeout(() => setUploadProgress(0), 600);

    return {
      ok: true as const,
      item: uploadResult.item,
    };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setMetadataMessage(null);
    setPriceReviewNotice(null);
    setFieldErrors((current) => ({ ...current, imageFile: undefined, description: undefined }));

    const ownerEmail = await getAuthenticatedEmail();
    if (!ownerEmail) {
      persistReturnTo(`/wishlists/${wishlistId}`);
      router.replace(`/login?returnTo=${encodeURIComponent(`/wishlists/${wishlistId}`)}`);
      return;
    }

    const draftText = form.description.trim();
    const normalizedUrl = form.url.trim();
    if (!draftText && !normalizedUrl) {
      setFieldErrors({
        description: "Enter title, description, and price details, or provide a product URL to import.",
      });
      return;
    }

    setIsSubmitting(true);

    let draftTextForParsing = draftText;
    let submissionImageUrls = [...form.imageUrls];
    let submissionTarget = form.target;
    let metadataReviewNotice: string | null = null;

    if (normalizedUrl) {
      setMetadataMessage("Importing details from URL before save...");
      const metadataResult = await fetchMetadataForUrl({
        ownerEmail,
        url: normalizedUrl,
        specNotes: draftTextForParsing,
      });

      if (metadataResult.ok) {
        const metadataImageUrls = Array.isArray(metadataResult.metadata.imageUrls)
          ? metadataResult.metadata.imageUrls.map((url) => (url || "").trim()).filter(Boolean)
          : [];
        const fallbackSingleImage = metadataResult.metadata.imageUrl?.trim() || "";
        if (metadataImageUrls.length === 0 && fallbackSingleImage) {
          metadataImageUrls.push(fallbackSingleImage);
        }

        if (metadataImageUrls.length > 0) {
          submissionImageUrls = Array.from(new Set([...submissionImageUrls, ...metadataImageUrls])).slice(
            0,
            CLIENT_MAX_ITEM_IMAGES,
          );
        }

        draftTextForParsing = mergeDraftTextWithImported({
          currentDraftText: draftTextForParsing,
          importedTitle: metadataResult.metadata.title,
          importedDescription: metadataResult.metadata.description,
          importedPriceCents: metadataResult.metadata.priceCents,
        });
        metadataReviewNotice = metadataResult.reviewNotice;
        setMetadataMessage(
          `URL details applied before save. Imported ${Math.min(metadataResult.importedImageCount, CLIENT_MAX_ITEM_IMAGES)} image(s).`,
        );

        if (form.isGroupFunded && !submissionTarget && metadataResult.metadata.priceCents !== null) {
          submissionTarget = centsToDisplay(metadataResult.metadata.priceCents);
        }
      } else {
        setMetadataMessage(metadataResult.message);
      }
    }

    if (!draftTextForParsing.trim()) {
      setIsSubmitting(false);
      setFieldErrors({
        description: "Could not import item details from URL. Add item details in the text field or try another URL.",
      });
      return;
    }

    const parsedDraftResult = await parseDraftTextWithAi(ownerEmail, draftTextForParsing);
    if (!parsedDraftResult) {
      setIsSubmitting(false);
      return;
    }

    const payload = buildPayload(
      wishlistId,
      {
        ...form,
        imageUrls: submissionImageUrls,
        target: submissionTarget,
      },
      parsedDraftResult.parsed,
    );

    if (payload.isGroupFunded && (payload.targetCents === null || Number.isNaN(payload.targetCents))) {
      setIsSubmitting(false);
      setFieldErrors({ targetCents: "Target must be a valid decimal amount." });
      return;
    }
    if (payload.imageUrls.length > CLIENT_MAX_ITEM_IMAGES) {
      setIsSubmitting(false);
      setFieldErrors({ imageFile: `Up to ${CLIENT_MAX_ITEM_IMAGES} images are allowed per item.` });
      return;
    }

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

    if (!response.ok || !result.ok) {
      setIsSubmitting(false);
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
    setPriceReviewNotice(
      metadataReviewNotice ||
        (parsedDraftResult.priceNeedsReview
          ? parsedDraftResult.priceReviewMessage || "Imported price may be missing or inaccurate. Please verify."
          : null),
    );

    const currentImageUrls = getItemImageUrls(result.item);
    const primaryImageRef = currentImageUrls[0] || null;

    if (currentImageUrls.length === 0) {
      setImagePreviewByItemId((current) => {
        const next = { ...current };
        delete next[result.item.id];
        return next;
      });
    }

    const queuedImages = [...pendingImages];
    if (queuedImages.length > 0) {
      for (let index = 0; index < queuedImages.length; index += 1) {
        const queuedImage = queuedImages[index];
        setImageMessage(`Uploading image ${index + 1} of ${queuedImages.length}...`);
        const uploadOutcome = await uploadImageForItem(result.item.id, queuedImage.file);
        if (!uploadOutcome.ok) {
          setIsSubmitting(false);
          setFormError("Item saved, but at least one image upload failed. Retry remaining images.");
          return;
        }
        removePendingImage(queuedImage.id);
      }
      setImageMessage(
        queuedImages.length === 1 ? "1 image uploaded." : `${queuedImages.length} images uploaded.`,
      );
    } else if (primaryImageRef && isStorageImageRef(primaryImageRef)) {
      await hydratePreviewForItem(result.item.id, currentImageUrls);
    }

    setIsSubmitting(false);

    if (!editingItemId) {
      setForm(EMPTY_FORM);
      setMetadataMessage(null);
      clearPendingImages();
    }
  }

  async function onArchive(itemId: string) {
    const ownerEmail = await getAuthenticatedEmail();
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

  async function onRestore(itemId: string) {
    const ownerEmail = await getAuthenticatedEmail();
    if (!ownerEmail) {
      persistReturnTo(`/wishlists/${wishlistId}`);
      router.replace(`/login?returnTo=${encodeURIComponent(`/wishlists/${wishlistId}`)}`);
      return;
    }

    setIsRestoringItemId(itemId);

    let response: Response;
    try {
      response = await fetch(`/api/items/${itemId}/archive`, {
        method: "DELETE",
        headers: {
          "x-owner-email": ownerEmail,
        },
      });
    } catch {
      setIsRestoringItemId(null);
      setFormError("Unable to restore item right now.");
      return;
    }

    const payload = (await response.json()) as ItemApiResponse;
    setIsRestoringItemId(null);

    if (!response.ok || !payload.ok) {
      const message = payload && !payload.ok ? payload.error.message : "Unable to restore item.";
      setFormError(message);
      return;
    }

    setItems((current) => current.map((item) => (item.id === payload.item.id ? payload.item : item)));
    setFormSuccess("Item restored to wishlist.");
    closeItemReview();
  }

  async function copyShareLink(value: string) {
    if (copyLinkFeedbackTimerRef.current) {
      clearTimeout(copyLinkFeedbackTimerRef.current);
      copyLinkFeedbackTimerRef.current = null;
    }

    try {
      await navigator.clipboard.writeText(value);
      setShareLinkMessage("Wishlist link copied.");
      setShareLinkError(null);
      setIsCopyLinkConfirmed(true);
      copyLinkFeedbackTimerRef.current = setTimeout(() => {
        setIsCopyLinkConfirmed(false);
        copyLinkFeedbackTimerRef.current = null;
      }, 1200);
    } catch {
      setShareLinkMessage(null);
      setShareLinkError("Clipboard unavailable. Copy the link manually.");
      setIsCopyLinkConfirmed(false);
    }
  }

  async function onRemoveImages() {
    setFormError(null);
    setFormSuccess(null);
    setImageMessage(null);
    setMetadataMessage(null);

    if (!editingItemId) {
      setForm((current) => ({ ...current, imageUrls: [] }));
      clearPendingImages();
      setImageMessage("Images removed from draft.");
      return;
    }

    const ownerEmail = await getAuthenticatedEmail();
    if (!ownerEmail) {
      persistReturnTo(`/wishlists/${wishlistId}`);
      router.replace(`/login?returnTo=${encodeURIComponent(`/wishlists/${wishlistId}`)}`);
      return;
    }

    const draftText = form.description.trim();
    const normalizedUrl = form.url.trim();
    let draftTextForParsing = draftText;

    if (!draftTextForParsing && normalizedUrl) {
      setMetadataMessage("Importing details from URL before save...");
      const metadataResult = await fetchMetadataForUrl({
        ownerEmail,
        url: normalizedUrl,
        specNotes: draftTextForParsing,
      });

      if (metadataResult.ok) {
        draftTextForParsing = mergeDraftTextWithImported({
          currentDraftText: draftTextForParsing,
          importedTitle: metadataResult.metadata.title,
          importedDescription: metadataResult.metadata.description,
          importedPriceCents: metadataResult.metadata.priceCents,
        });
        setMetadataMessage("URL details applied before save.");
      } else {
        setMetadataMessage(metadataResult.message);
      }
    }

    if (!draftTextForParsing.trim()) {
      setFieldErrors({
        description: "Could not import item details from URL. Add item details in the text field or try another URL.",
      });
      return;
    }

    const parsedDraftResult = await parseDraftTextWithAi(ownerEmail, draftTextForParsing);
    if (!parsedDraftResult) return;

    const payload = buildPayload(wishlistId, { ...form, imageUrls: [] }, parsedDraftResult.parsed);

    if (payload.isGroupFunded && (payload.targetCents === null || Number.isNaN(payload.targetCents))) {
      setFieldErrors({ targetCents: "Target must be a valid decimal amount." });
      return;
    }

    setIsSubmitting(true);

    let response: Response;
    try {
      response = await fetch(`/api/items/${editingItemId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-owner-email": ownerEmail,
        },
        body: JSON.stringify(payload),
      });
    } catch {
      setIsSubmitting(false);
      setFormError("Unable to remove image right now. Please retry.");
      return;
    }

    const result = (await response.json()) as ItemApiResponse;
    setIsSubmitting(false);

    if (!response.ok || !result.ok) {
      const message = result && !result.ok ? result.error.message : "Unable to remove image right now.";
      setFormError(message);
      if (result && !result.ok) {
        applyServerFieldErrors(result.error.fieldErrors);
      }
      return;
    }

    setItems((current) => current.map((item) => (item.id === result.item.id ? result.item : item)));
    setForm((current) => ({ ...current, imageUrls: [] }));
    setImagePreviewByItemId((current) => {
      const next = { ...current };
      delete next[editingItemId];
      return next;
    });
    clearPendingImages();
    setFormSuccess("Images removed.");
  }

  const imageButtonLabel = activeImageCount > 0 ? "Add images" : "Upload images";

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Wishlist editor</h1>
          <p className="mt-1 text-sm text-zinc-600">Manage item details and archive items after activity.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            className={`group relative overflow-hidden rounded-full bg-gradient-to-r px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:brightness-110 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${
              isCopyLinkConfirmed
                ? "from-emerald-500 to-teal-500 ring-2 ring-emerald-200 animate-[pulse_900ms_ease-out_1]"
                : "from-sky-500 to-blue-600"
            }`}
            disabled={!shareUrlPreview}
            onClick={() => {
              if (!shareUrlPreview) return;
              void copyShareLink(shareUrlPreview);
            }}
            type="button"
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute inset-0 rounded-full transition-opacity duration-300 ${
                isCopyLinkConfirmed ? "bg-white/20 opacity-100" : "bg-white/10 opacity-0 group-hover:opacity-100"
              }`}
            />
            <span className="relative z-[1] flex items-center justify-center gap-1.5">
              {isCopyLinkConfirmed ? <span aria-hidden="true">✓</span> : null}
              {shareUrlPreview ? (isCopyLinkConfirmed ? "Copied!" : "Copy wishlist link") : "Wishlist link unavailable"}
            </span>
          </button>
          <Link
            className="rounded-full border border-zinc-300 bg-white/70 px-4 py-2 text-sm font-medium text-zinc-800 transition-all duration-200 hover:-translate-y-1 hover:scale-[1.02] hover:border-sky-300 hover:bg-white hover:shadow-lg active:translate-y-0 active:scale-[0.98]"
            href="/wishlists"
          >
            Back to My wishlists
          </Link>
        </div>
      </header>
      {shareLinkError ? <p className="mt-2 text-sm text-rose-700">{shareLinkError}</p> : null}
      {shareLinkMessage ? <p className="mt-2 text-sm text-emerald-700">{shareLinkMessage}</p> : null}
      {reservationLiveNotice ? <p className="mt-2 text-sm font-medium text-emerald-700">{reservationLiveNotice}</p> : null}

      <section className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="hidden lg:grid lg:col-span-2 lg:grid-cols-[1fr_1.2fr] lg:items-center lg:gap-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{editingItemId ? "Edit item" : "Add item"}</h2>
            {editingItemId ? (
              <button className="text-sm font-medium text-zinc-700 underline" onClick={resetForm} type="button">
                Cancel edit
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Items</h2>
            {activeItems.length > 0 ? (
              <p className="text-sm font-medium text-zinc-700">
                {activeReservedCount} of {activeItems.length} reserved
              </p>
            ) : null}
          </div>
        </div>

        <aside className="self-start rounded-2xl bg-white/50 p-4 sm:p-5">
          <div className="flex items-center justify-between lg:hidden">
            <h2 className="text-lg font-semibold">{editingItemId ? "Edit item" : "Add item"}</h2>
            {editingItemId ? (
              <button className="text-sm font-medium text-zinc-700 underline" onClick={resetForm} type="button">
                Cancel edit
              </button>
            ) : null}
          </div>

          <form className="mt-4 space-y-4 lg:mt-0" onSubmit={onSubmit} noValidate>
            <section className="rounded-xl border border-sky-100 bg-sky-50/40 p-3 sm:p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Title, Description & Price</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-zinc-600">
                <li>Include item name and short context.</li>
                <li>Add price in USD.</li>
                <li>Add must-have specs first: color, size, model, version.</li>
                <li>Optional: add extra notes like accessories.</li>
                <li>Optional: paste product URL below to import details. Your notes stay first.</li>
              </ul>

              <div className="mt-3">
                <label className="sr-only" htmlFor="item-description">
                  Item details
                </label>
                <textarea
                  className={`min-h-28 w-full rounded-md px-3 py-2 text-sm outline-none ${
                    priceReviewNotice
                      ? "border border-amber-400 bg-amber-50 focus:border-amber-500"
                      : "border border-zinc-300 focus:border-zinc-500"
                  }`}
                  id="item-description"
                  onChange={(event) => {
                    setPriceReviewNotice(null);
                    setForm((prev) => ({ ...prev, description: event.target.value }));
                  }}
                  placeholder={`Example:\nPrice: 129.99\niPhone 17 Pro Max Orange, 256 GB, unlocked`}
                  value={form.description}
                />
                {fieldErrors.description ? <p className="mt-1 text-xs text-rose-700">{fieldErrors.description}</p> : null}
                {priceReviewNotice ? <p className="mt-1 text-xs text-amber-700">{priceReviewNotice}</p> : null}
              </div>

              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium text-zinc-800" htmlFor="item-url">
                  Product URL
                </label>
                <input
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                  id="item-url"
                  onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))}
                  value={form.url}
                />
                <p className="mt-2 text-xs text-zinc-600">
                  Add item will auto-import details from this URL before saving.
                </p>
                {fieldErrors.url ? <p className="mt-1 text-xs text-rose-700">{fieldErrors.url}</p> : null}
                {duplicateUrlWarning ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Duplicate URL detected in this wishlist. You can still save.
                  </p>
                ) : null}
              </div>
            </section>

            <label className="flex items-center gap-2 text-sm text-zinc-800">
              <input
                checked={form.isGroupFunded}
                onChange={(event) => onToggleGroupFunded(event.target.checked)}
                type="checkbox"
              />
              <span>Group funded item</span>
            </label>

            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-sm font-medium text-zinc-800">Item images</p>
                <div className="mt-2 overflow-hidden rounded-md border border-zinc-200 bg-white">
                  {activeEditPreviewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt="Item preview"
                      className="h-28 w-full object-cover"
                      src={activeEditPreviewUrl}
                    />
                  ) : (
                    <div className="flex h-28 items-center justify-center text-xs text-zinc-500">No image selected</div>
                  )}
                </div>

                <input
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  multiple
                  onChange={onSelectImageFiles}
                  ref={fileInputRef}
                  type="file"
                />

                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-800"
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    {imageButtonLabel}
                  </button>
                  {activeImageCount > 0 ? (
                    <button
                      className="rounded-md border border-rose-300 px-3 py-2 text-xs font-medium text-rose-800"
                      onClick={onRemoveImages}
                      type="button"
                    >
                      Clear all images
                    </button>
                  ) : null}
                </div>

                <p className="mt-2 text-xs text-zinc-600">
                  {activeImageCount}/{CLIENT_MAX_ITEM_IMAGES} images selected. PNG, JPG, WEBP, or GIF up to 10 MB each.
                </p>

                {form.imageUrls.length > 0 ? (
                  <div className="mt-2">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
                      Saved and imported
                    </p>
                    <ul className="grid grid-cols-5 gap-2">
                      {form.imageUrls.map((imageUrl, index) => {
                        const thumbnailUrl = isStorageImageRef(imageUrl)
                          ? editingItemId
                            ? imagePreviewByItemId[editingItemId]?.[index] || null
                            : null
                          : imageUrl;

                        return (
                          <li className="group relative" key={`${imageUrl}-${index}`}>
                            <div className="h-11 w-11 overflow-hidden rounded-md border border-zinc-200 bg-white">
                              {thumbnailUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  alt={`Item image ${index + 1}`}
                                  className="h-full w-full object-cover"
                                  src={thumbnailUrl}
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500">
                                  IMG
                                </div>
                              )}
                            </div>
                            <button
                              aria-label={`Delete image ${index + 1}`}
                              className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-rose-300 bg-white text-[10px] font-bold text-rose-700 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                              onClick={() => removeDraftImageAt(index)}
                              title="Delete image"
                              type="button"
                            >
                              ×
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}

                {pendingImages.length > 0 ? (
                  <div className="mt-2">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
                      Pending upload
                    </p>
                    <ul className="grid grid-cols-5 gap-2">
                      {pendingImages.map((pendingImage, index) => (
                        <li className="group relative" key={pendingImage.id}>
                          <div className="h-11 w-11 overflow-hidden rounded-md border border-zinc-200 bg-white">
                            {
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                alt={`Pending image ${index + 1}`}
                                className="h-full w-full object-cover"
                                src={pendingImage.previewUrl}
                              />
                            }
                          </div>
                          <button
                            aria-label={`Delete pending image ${index + 1}`}
                            className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-rose-300 bg-white text-[10px] font-bold text-rose-700 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                            onClick={() => removePendingImage(pendingImage.id)}
                            title="Delete image"
                            type="button"
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {isUploadingImage ? (
                  <div className="mt-2 rounded-md border border-zinc-200 bg-white px-2 py-1">
                    <div className="h-1.5 w-full rounded bg-zinc-100">
                      <div className="h-1.5 rounded bg-zinc-800" style={{ width: `${uploadProgress}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] text-zinc-600">Uploading... {uploadProgress}%</p>
                  </div>
                ) : null}

                {fieldErrors.imageFile ? <p className="mt-2 text-xs text-rose-700">{fieldErrors.imageFile}</p> : null}
                {imageMessage ? <p className="mt-2 text-xs text-zinc-700">{imageMessage}</p> : null}
            </div>

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
              disabled={isSubmitting || isUploadingImage}
              type="submit"
            >
              {isSubmitting ? "Saving..." : editingItemId ? "Save item" : "Add item"}
            </button>
          </form>
        </aside>

        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 lg:hidden">
            <h2 className="text-lg font-semibold">Items</h2>
            {activeItems.length > 0 ? (
              <p className="text-sm font-medium text-zinc-700">
                {activeReservedCount} of {activeItems.length} reserved
              </p>
            ) : null}
          </div>

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
            activeItems.map((item) => {
              const displayPrice = item.priceCents !== null ? `$${(item.priceCents / 100).toFixed(2)}` : null;
              const summaryParts: string[] = [];
              if (item.url) summaryParts.push(item.url);
              const liveAvailability = availabilityByItemId[item.id];
              const contributionSummary = contributionByItemId[item.id] || {
                fundedCents: item.fundedCents,
                contributorCount: item.contributorCount,
              };
              const fundedDisplay = `$${(contributionSummary.fundedCents / 100).toFixed(2)}`;
              const contributorLabel = contributionSummary.contributorCount === 1 ? "person" : "people";

              return (
                <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm" key={item.id}>
                  <div className="grid gap-3 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-start">
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
                      {imagePreviewByItemId[item.id]?.[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt={`${item.title} preview`}
                          className="h-full w-full object-cover"
                          src={imagePreviewByItemId[item.id][0]}
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[11px] text-zinc-500">No image</div>
                      )}
                    </div>

                    <div className="min-w-0 sm:col-start-2 sm:col-end-3">
                      <h3 className="text-base font-semibold">
                        <button
                          className="text-left text-zinc-900 underline-offset-2 transition hover:text-blue-900 hover:underline"
                          onClick={() => void openItemReview(item)}
                          type="button"
                        >
                          {item.title}
                        </button>
                      </h3>
                      {displayPrice ? <p className="mt-1 text-base font-semibold text-blue-900">{displayPrice}</p> : null}
                      {liveAvailability ? (
                        <p
                          className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                            liveAvailability === "reserved"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {liveAvailability === "reserved" ? "Reserved" : "Available"}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 gap-2 sm:justify-self-end">
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

                    <div className="min-w-0 sm:col-start-2 sm:col-end-4">
                      {item.description ? (
                        <p className="mt-1 overflow-hidden text-sm text-zinc-700 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]">
                          {item.description}
                        </p>
                      ) : null}
                      {summaryParts.length > 0 ? (
                        <p className="mt-1 truncate text-xs text-zinc-600" title={summaryParts.join(" • ")}>
                          {summaryParts.join(" • ")}
                        </p>
                      ) : null}
                      {item.isGroupFunded ? (
                        <>
                          <p className="mt-1 text-xs text-zinc-600">
                            Group-funded target: {item.targetCents !== null ? `$${(item.targetCents / 100).toFixed(2)}` : "Unset"}
                          </p>
                          <p className="mt-1 text-xs text-zinc-700">
                            Contributed: {fundedDisplay} by {contributionSummary.contributorCount} {contributorLabel}
                          </p>
                        </>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })
          )}

          {archivedItems.length > 0 ? (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <h3 className="text-sm font-semibold text-zinc-900">Archived items</h3>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-zinc-700">
                {archivedItems.map((item) => (
                  <li key={item.id}>
                    <button
                      className="text-left underline-offset-2 transition hover:text-blue-900 hover:underline"
                      onClick={() => void openItemReview(item)}
                      type="button"
                    >
                      {item.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </section>

      {reviewingItem ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/45 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeItemReview();
          }}
        >
          <section className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl">
            <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-zinc-900">Item review</h3>
                {reviewingItem.archivedAt ? (
                  <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-700">
                    Archived
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {reviewingItem.archivedAt ? (
                  <button
                    className="rounded-md border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-800"
                    disabled={isRestoringItemId === reviewingItem.id}
                    onClick={() => void onRestore(reviewingItem.id)}
                    type="button"
                  >
                    {isRestoringItemId === reviewingItem.id ? "Restoring..." : "Put back to wishlist"}
                  </button>
                ) : null}
                <button
                  className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700"
                  onClick={closeItemReview}
                  type="button"
                >
                  Close
                </button>
              </div>
            </header>

            <div className="grid max-h-[calc(92vh-4.1rem)] gap-4 overflow-y-auto p-4 lg:grid-cols-[1.15fr_1fr]">
              <div>
                <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
                  {isLoadingReviewImages ? (
                    <div className="h-[320px] animate-pulse bg-zinc-100" />
                  ) : currentReviewImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={`${reviewingItem.title} photo ${reviewImageIndex + 1}`}
                      className="h-[320px] w-full object-contain bg-white"
                      src={currentReviewImageUrl}
                    />
                  ) : (
                    <div className="flex h-[320px] items-center justify-center text-sm text-zinc-500">No image preview available</div>
                  )}
                </div>

                {reviewImageError ? <p className="mt-2 text-xs text-rose-700">{reviewImageError}</p> : null}

                {reviewImageUrls.length > 1 ? (
                  <>
                    <div className="mt-3 flex items-center justify-between">
                      <button
                        className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700"
                        onClick={() =>
                          setReviewImageIndex((current) =>
                            current === 0 ? reviewImageUrls.length - 1 : current - 1,
                          )
                        }
                        type="button"
                      >
                        Previous
                      </button>
                      <p className="text-xs text-zinc-600">
                        Photo {reviewImageIndex + 1} of {reviewImageUrls.length}
                      </p>
                      <button
                        className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700"
                        onClick={() =>
                          setReviewImageIndex((current) =>
                            current === reviewImageUrls.length - 1 ? 0 : current + 1,
                          )
                        }
                        type="button"
                      >
                        Next
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {reviewImageUrls.map((url, index) => (
                        <button
                          className={`h-14 w-14 overflow-hidden rounded-md border ${
                            index === reviewImageIndex ? "border-blue-500 ring-1 ring-blue-400" : "border-zinc-200"
                          }`}
                          key={`${url}-${index}`}
                          onClick={() => setReviewImageIndex(index)}
                          type="button"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img alt={`${reviewingItem.title} thumbnail ${index + 1}`} className="h-full w-full object-cover" src={url} />
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>

              <div className="space-y-3">
                <h4 className="text-xl font-semibold text-blue-900">{reviewingItem.title}</h4>
                {reviewingItem.priceCents !== null ? (
                  <p className="text-xl font-semibold text-blue-900">${(reviewingItem.priceCents / 100).toFixed(2)}</p>
                ) : null}
                {reviewingItem.description ? (
                  <p className="text-sm leading-6 text-zinc-700 whitespace-pre-wrap">{reviewingItem.description}</p>
                ) : (
                  <p className="text-sm text-zinc-500">No description provided.</p>
                )}
                {reviewingItem.url ? (
                  <a
                    className="block break-all text-sm font-medium text-sky-700 underline underline-offset-2"
                    href={reviewingItem.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {reviewingItem.url}
                  </a>
                ) : null}
                {reviewingItem.isGroupFunded ? (
                  <div className="space-y-1 text-sm text-zinc-700">
                    <p>
                      Group-funded target:{" "}
                      {reviewingItem.targetCents !== null ? `$${(reviewingItem.targetCents / 100).toFixed(2)}` : "Unset"}
                    </p>
                    <p>
                      Contributed: ${((reviewingContributionSummary?.fundedCents || 0) / 100).toFixed(2)} by{" "}
                      {reviewingContributionSummary?.contributorCount || 0}{" "}
                      {(reviewingContributionSummary?.contributorCount || 0) === 1 ? "person" : "people"}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
