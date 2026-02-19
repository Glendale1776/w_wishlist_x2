"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

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

type ItemFieldErrors = Partial<
  Record<"title" | "url" | "priceCents" | "imageUrl" | "targetCents" | "imageFile", string>
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

type RotateShareLinkResponse =
  | {
      ok: true;
      alreadyProcessed: boolean;
      rotatedAt: string | null;
      shareUrl: string | null;
      shareUrlPreview: string | null;
      auditEventId?: string;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        fieldErrors?: Record<string, string>;
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

const CLIENT_MAX_UPLOAD_MB = 10;
const CLIENT_MAX_UPLOAD_BYTES = CLIENT_MAX_UPLOAD_MB * 1024 * 1024;
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

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isStorageImageRef(value: string | null | undefined) {
  return Boolean(value && value.startsWith("storage://"));
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
  const [oneTimeShareUrl, setOneTimeShareUrl] = useState<string | null>(null);
  const [isRotatingShareLink, setIsRotatingShareLink] = useState(false);
  const [rotateShareLinkError, setRotateShareLinkError] = useState<string | null>(null);
  const [rotateShareLinkSuccess, setRotateShareLinkSuccess] = useState<string | null>(null);

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [form, setForm] = useState<ItemFormValues>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<ItemFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [metadataMessage, setMetadataMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);

  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [imagePreviewByItemId, setImagePreviewByItemId] = useState<Record<string, string>>({});
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [imageMessage, setImageMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const activeEditPreviewUrl = useMemo(() => {
    if (localPreviewUrl) return localPreviewUrl;
    if (!editingItemId) return null;
    return imagePreviewByItemId[editingItemId] || null;
  }, [editingItemId, imagePreviewByItemId, localPreviewUrl]);

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
          const wishlistsResponse = await fetch("/api/wishlists", {
            headers: {
              "x-owner-email": ownerEmail,
            },
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
    let cancelled = false;

    async function hydratePreviews() {
      const ownerEmail = await getAuthenticatedEmail();
      if (!ownerEmail || items.length === 0) {
        if (!cancelled) setImagePreviewByItemId({});
        return;
      }

      const next: Record<string, string> = {};

      await Promise.all(
        items.map(async (item) => {
          if (!item.imageUrl) return;

          if (!isStorageImageRef(item.imageUrl)) {
            next[item.id] = item.imageUrl;
            return;
          }

          try {
            const response = await fetch(`/api/items/${item.id}/image-upload-url`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-owner-email": ownerEmail,
              },
              body: JSON.stringify({ mode: "preview" }),
            });

            const payload = (await response.json()) as ImagePreviewResponse;
            if (!response.ok || !payload.ok || !payload.previewUrl) return;
            next[item.id] = payload.previewUrl;
          } catch {
            return;
          }
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
    return () => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }
    };
  }, [localPreviewUrl]);

  function clearSelectedImage() {
    setSelectedImageFile(null);
    setLocalPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function resetForm() {
    setEditingItemId(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
    setFormSuccess(null);
    setMetadataMessage(null);
    setImageMessage(null);
    clearSelectedImage();
    setUploadProgress(0);
  }

  async function hydratePreviewForItem(itemId: string) {
    const ownerEmail = await getAuthenticatedEmail();
    if (!ownerEmail) return;

    try {
      const response = await fetch(`/api/items/${itemId}/image-upload-url`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-owner-email": ownerEmail,
        },
        body: JSON.stringify({ mode: "preview" }),
      });

      const payload = (await response.json()) as ImagePreviewResponse;
      if (!response.ok || !payload.ok) return;

      setImagePreviewByItemId((current) => {
        const next = { ...current };
        if (payload.previewUrl) {
          next[itemId] = payload.previewUrl;
        } else {
          delete next[itemId];
        }
        return next;
      });
    } catch {
      return;
    }
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
    setImageMessage(null);
    clearSelectedImage();
    setUploadProgress(0);

    if (item.imageUrl && isStorageImageRef(item.imageUrl)) {
      void hydratePreviewForItem(item.id);
    }

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

  function onSelectImageFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    if (!file) return;

    setFieldErrors((current) => ({ ...current, imageFile: undefined }));
    setImageMessage(null);

    const normalizedMime = file.type.trim().toLowerCase();
    if (!CLIENT_ALLOWED_MIME_TYPES.has(normalizedMime)) {
      setFieldErrors((current) => ({
        ...current,
        imageFile: "Only PNG, JPG, WEBP, and GIF images are supported.",
      }));
      event.target.value = "";
      return;
    }

    if (file.size > CLIENT_MAX_UPLOAD_BYTES) {
      setFieldErrors((current) => ({
        ...current,
        imageFile: `Image must be ${CLIENT_MAX_UPLOAD_MB} MB or smaller.`,
      }));
      event.target.value = "";
      return;
    }

    setSelectedImageFile(file);
    setLocalPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });

    setImageMessage(editingItemId ? "Image selected. Save item to upload." : "Image selected. It will upload after item creation.");
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
    setForm((current) => ({ ...current, imageUrl: uploadResult.item.imageUrl || "" }));

    setImagePreviewByItemId((current) => {
      const next = { ...current };
      if (uploadResult.previewUrl) {
        next[itemId] = uploadResult.previewUrl;
      } else {
        delete next[itemId];
      }
      return next;
    });

    clearSelectedImage();
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
    setFieldErrors((current) => ({ ...current, imageFile: undefined }));

    const ownerEmail = await getAuthenticatedEmail();
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

    if (!result.item.imageUrl) {
      setImagePreviewByItemId((current) => {
        const next = { ...current };
        delete next[result.item.id];
        return next;
      });
    }

    if (selectedImageFile) {
      const uploadOutcome = await uploadImageForItem(result.item.id, selectedImageFile);
      if (!uploadOutcome.ok) {
        setIsSubmitting(false);
        setFormError("Item saved, but image upload failed. Retry upload.");
        return;
      }
    } else if (result.item.imageUrl && isStorageImageRef(result.item.imageUrl)) {
      await hydratePreviewForItem(result.item.id);
    }

    setIsSubmitting(false);

    if (!editingItemId) {
      setForm(EMPTY_FORM);
      setMetadataMessage(null);
      clearSelectedImage();
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

  async function copyShareLink(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setRotateShareLinkSuccess("Share link copied.");
      setRotateShareLinkError(null);
    } catch {
      setRotateShareLinkError("Clipboard unavailable. Copy the link manually.");
    }
  }

  function dismissOneTimeShareLink() {
    setOneTimeShareUrl(null);
    setRotateShareLinkSuccess("One-time reveal dismissed.");
  }

  async function onRotateShareLink() {
    const ownerEmail = await getAuthenticatedEmail();
    if (!ownerEmail) {
      persistReturnTo(`/wishlists/${wishlistId}`);
      router.replace(`/login?returnTo=${encodeURIComponent(`/wishlists/${wishlistId}`)}`);
      return;
    }

    setIsRotatingShareLink(true);
    setRotateShareLinkError(null);
    setRotateShareLinkSuccess(null);

    let response: Response;
    try {
      response = await fetch(`/api/wishlists/${wishlistId}/rotate-share-link`, {
        method: "POST",
        headers: {
          "x-owner-email": ownerEmail,
          "x-idempotency-key": createIdempotencyKey(),
        },
      });
    } catch {
      setIsRotatingShareLink(false);
      setRotateShareLinkError("Unable to rotate share link right now. Please retry.");
      return;
    }

    const payload = (await response.json()) as RotateShareLinkResponse;
    setIsRotatingShareLink(false);

    if (!response.ok || !payload.ok) {
      const message = payload && !payload.ok ? payload.error.message : "Unable to rotate share link right now.";
      setRotateShareLinkError(message);
      return;
    }

    if (payload.alreadyProcessed) {
      setOneTimeShareUrl(null);
      setRotateShareLinkSuccess("Rotation already processed. Generate again for a new one-time link.");
      return;
    }

    setOneTimeShareUrl(payload.shareUrl);
    setShareUrlPreview(payload.shareUrlPreview);
    setRotateShareLinkSuccess("Share link rotated. Copy the new link now before dismissing.");
  }

  async function onAutofillFromUrl() {
    setMetadataMessage(null);

    const ownerEmail = await getAuthenticatedEmail();
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

  async function onRemoveImage() {
    setFormError(null);
    setFormSuccess(null);
    setImageMessage(null);

    if (!editingItemId) {
      setForm((current) => ({ ...current, imageUrl: "" }));
      clearSelectedImage();
      setImageMessage("Image removed from draft.");
      return;
    }

    const ownerEmail = await getAuthenticatedEmail();
    if (!ownerEmail) {
      persistReturnTo(`/wishlists/${wishlistId}`);
      router.replace(`/login?returnTo=${encodeURIComponent(`/wishlists/${wishlistId}`)}`);
      return;
    }

    const payload = buildPayload(wishlistId, { ...form, imageUrl: "" });

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
    setForm((current) => ({ ...current, imageUrl: "" }));
    setImagePreviewByItemId((current) => {
      const next = { ...current };
      delete next[editingItemId];
      return next;
    });
    clearSelectedImage();
    setFormSuccess("Image removed.");
  }

  const imageButtonLabel = activeEditPreviewUrl || form.imageUrl ? "Replace image" : "Upload image";

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

          <section className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            <h3 className="text-sm font-semibold text-zinc-900">Share link settings</h3>
            <p className="mt-1 text-xs text-zinc-600">
              Regenerating is immediate and invalidates the previous public link.
            </p>

            <div className="mt-3 rounded-md border border-zinc-200 bg-white p-3">
              <p className="text-xs font-medium text-zinc-700">Current share link</p>
              <p className="mt-1 break-all text-xs text-zinc-600">{shareUrlPreview || "Unavailable until wishlist sync completes."}</p>

              <div className="mt-3 flex flex-wrap gap-2">
                {shareUrlPreview ? (
                  <button
                    className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-800"
                    onClick={() => copyShareLink(shareUrlPreview)}
                    type="button"
                  >
                    Copy current link
                  </button>
                ) : null}
                <button
                  className="rounded-md border border-rose-300 px-3 py-2 text-xs font-medium text-rose-800 disabled:opacity-60"
                  disabled={isRotatingShareLink}
                  onClick={onRotateShareLink}
                  type="button"
                >
                  {isRotatingShareLink ? "Regenerating..." : "Regenerate link"}
                </button>
              </div>
            </div>

            {oneTimeShareUrl ? (
              <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-900">One-time reveal: copy this new link now.</p>
                <p className="mt-1 break-all text-xs text-amber-900">{oneTimeShareUrl}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="rounded-md border border-amber-400 px-3 py-2 text-xs font-medium text-amber-900"
                    onClick={() => copyShareLink(oneTimeShareUrl)}
                    type="button"
                  >
                    Copy new link
                  </button>
                  <button
                    className="rounded-md border border-amber-400 px-3 py-2 text-xs font-medium text-amber-900"
                    onClick={dismissOneTimeShareLink}
                    type="button"
                  >
                    Dismiss reveal
                  </button>
                </div>
              </div>
            ) : null}

            {rotateShareLinkError ? <p className="mt-2 text-xs text-rose-700">{rotateShareLinkError}</p> : null}
            {rotateShareLinkSuccess ? <p className="mt-2 text-xs text-emerald-700">{rotateShareLinkSuccess}</p> : null}
          </section>

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

              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-sm font-medium text-zinc-800">Item image</p>
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
                  onChange={onSelectImageFile}
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
                  {activeEditPreviewUrl || form.imageUrl || selectedImageFile ? (
                    <button
                      className="rounded-md border border-rose-300 px-3 py-2 text-xs font-medium text-rose-800"
                      onClick={onRemoveImage}
                      type="button"
                    >
                      Remove image
                    </button>
                  ) : null}
                </div>

                <p className="mt-2 text-xs text-zinc-600">PNG, JPG, WEBP, or GIF up to 10 MB.</p>

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
              disabled={isSubmitting || isUploadingImage}
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
                <div className="flex flex-wrap items-start gap-3">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
                    {imagePreviewByItemId[item.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt={`${item.title} preview`}
                        className="h-full w-full object-cover"
                        src={imagePreviewByItemId[item.id]}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[11px] text-zinc-500">No image</div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-zinc-900">{item.title}</h3>
                        <p className="mt-1 text-xs text-zinc-600">
                          {item.url ? item.url : "No product URL"} •{" "}
                          {item.priceCents !== null ? `$${(item.priceCents / 100).toFixed(2)}` : "No price"}
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
