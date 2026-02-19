import { randomUUID } from "node:crypto";

export type ItemRecord = {
  id: string;
  wishlistId: string;
  ownerEmail: string;
  title: string;
  url: string | null;
  priceCents: number | null;
  imageUrl: string | null;
  isGroupFunded: boolean;
  targetCents: number | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AuditEvent = {
  id: string;
  action: "create" | "update" | "archive";
  entityId: string;
  ownerEmail: string;
  createdAt: string;
};

type StoredImage = {
  path: string;
  itemId: string;
  wishlistId: string;
  ownerEmail: string;
  contentType: string;
  sizeBytes: number;
  dataBase64: string;
  createdAt: string;
  updatedAt: string;
};

type UploadTicket = {
  token: string;
  itemId: string;
  ownerEmail: string;
  path: string;
  mimeType: string;
  maxBytes: number;
  expiresAt: number;
};

type PreviewTicket = {
  token: string;
  itemId: string;
  path: string;
  expiresAt: number;
};

export type PrepareImageUploadError =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "ARCHIVED"
  | "INVALID_MIME"
  | "FILE_TOO_LARGE"
  | "INVALID_SIZE";

export type UploadItemImageError =
  | "INVALID_UPLOAD_TOKEN"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "ARCHIVED"
  | "INVALID_MIME"
  | "FILE_TOO_LARGE"
  | "INVALID_SIZE";

export type CreatePreviewError = "NOT_FOUND" | "FORBIDDEN";
export type ResolvePreviewError = "INVALID_PREVIEW_TOKEN" | "NOT_FOUND";

const STORAGE_PREFIX = "storage://";

export type PublicItemReadModel = {
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
  updatedAt: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __itemStore:
    | {
        items: ItemRecord[];
        auditEvents: AuditEvent[];
        images: StoredImage[];
        uploadTickets: UploadTicket[];
        previewTickets: PreviewTicket[];
      }
    | undefined;
}

function getStore() {
  if (!globalThis.__itemStore) {
    globalThis.__itemStore = {
      items: [],
      auditEvents: [],
      images: [],
      uploadTickets: [],
      previewTickets: [],
    };
  }
  return globalThis.__itemStore;
}

function logAudit(action: AuditEvent["action"], entityId: string, ownerEmail: string) {
  const store = getStore();
  store.auditEvents.unshift({
    id: randomUUID(),
    action,
    entityId,
    ownerEmail,
    createdAt: new Date().toISOString(),
  });
}

function findDuplicateUrl(input: {
  wishlistId: string;
  normalizedUrl: string;
  ignoreItemId?: string;
}) {
  const store = getStore();
  return store.items.some((item) => {
    if (item.wishlistId !== input.wishlistId) return false;
    if (item.archivedAt) return false;
    if (input.ignoreItemId && item.id === input.ignoreItemId) return false;
    return (item.url || "").toLowerCase() === input.normalizedUrl;
  });
}

function nowIso() {
  return new Date().toISOString();
}

function isStorageRef(value: string | null | undefined): value is string {
  return Boolean(value && value.startsWith(STORAGE_PREFIX));
}

function parseStoragePath(reference: string): string {
  return reference.slice(STORAGE_PREFIX.length);
}

function removeImageByPath(path: string) {
  const store = getStore();
  store.images = store.images.filter((image) => image.path !== path);
  store.previewTickets = store.previewTickets.filter((ticket) => ticket.path !== path);
}

function pruneExpiredTickets(now = Date.now()) {
  const store = getStore();
  store.uploadTickets = store.uploadTickets.filter((ticket) => ticket.expiresAt > now);
  store.previewTickets = store.previewTickets.filter((ticket) => ticket.expiresAt > now);
}

function sanitizeFilename(filename: string): string {
  const withoutPath = filename.split(/[\\/]/).pop() || "image";
  const normalized = withoutPath
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "image";
}

function buildStoragePath(input: { ownerEmail: string; wishlistId: string; itemId: string; filename: string }) {
  const ownerToken = encodeURIComponent(input.ownerEmail);
  return `owners/${ownerToken}/${input.wishlistId}/${input.itemId}/${Date.now()}-${sanitizeFilename(input.filename)}`;
}

function createPreviewTicket(itemId: string, path: string, ttlSeconds: number) {
  const store = getStore();
  pruneExpiredTickets();

  const token = randomUUID();
  store.previewTickets.push({
    token,
    itemId,
    path,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  return token;
}

export function createItem(input: {
  wishlistId: string;
  ownerEmail: string;
  title: string;
  url: string | null;
  priceCents: number | null;
  imageUrl: string | null;
  isGroupFunded: boolean;
  targetCents: number | null;
}) {
  const now = nowIso();
  const normalizedUrl = (input.url || "").trim().toLowerCase();

  const duplicateUrl = normalizedUrl
    ? findDuplicateUrl({
        wishlistId: input.wishlistId,
        normalizedUrl,
      })
    : false;

  const item: ItemRecord = {
    id: randomUUID(),
    wishlistId: input.wishlistId,
    ownerEmail: input.ownerEmail,
    title: input.title,
    url: input.url,
    priceCents: input.priceCents,
    imageUrl: input.imageUrl,
    isGroupFunded: input.isGroupFunded,
    targetCents: input.targetCents,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const store = getStore();
  store.items.unshift(item);
  logAudit("create", item.id, input.ownerEmail);

  return {
    item,
    duplicateUrl,
  };
}

export function updateItem(input: {
  itemId: string;
  ownerEmail: string;
  title: string;
  url: string | null;
  priceCents: number | null;
  imageUrl: string | null;
  isGroupFunded: boolean;
  targetCents: number | null;
}) {
  const store = getStore();
  const found = store.items.find((item) => item.id === input.itemId);
  if (!found) return { error: "NOT_FOUND" as const };
  if (found.ownerEmail !== input.ownerEmail) return { error: "FORBIDDEN" as const };

  const normalizedUrl = (input.url || "").trim().toLowerCase();
  const duplicateUrl = normalizedUrl
    ? findDuplicateUrl({
        wishlistId: found.wishlistId,
        normalizedUrl,
        ignoreItemId: found.id,
      })
    : false;

  const previousImageUrl = found.imageUrl;

  found.title = input.title;
  found.url = input.url;
  found.priceCents = input.priceCents;
  found.imageUrl = input.imageUrl;
  found.isGroupFunded = input.isGroupFunded;
  found.targetCents = input.targetCents;
  found.updatedAt = nowIso();

  if (previousImageUrl && previousImageUrl !== found.imageUrl && isStorageRef(previousImageUrl)) {
    removeImageByPath(parseStoragePath(previousImageUrl));
  }

  logAudit("update", found.id, input.ownerEmail);

  return {
    item: found,
    duplicateUrl,
  };
}

export function archiveItem(input: { itemId: string; ownerEmail: string }) {
  const store = getStore();
  const found = store.items.find((item) => item.id === input.itemId);
  if (!found) return { error: "NOT_FOUND" as const };
  if (found.ownerEmail !== input.ownerEmail) return { error: "FORBIDDEN" as const };

  if (!found.archivedAt) {
    found.archivedAt = nowIso();
    found.updatedAt = found.archivedAt;
    logAudit("archive", found.id, input.ownerEmail);
  }

  return {
    item: found,
  };
}

export function listItemsForWishlist(input: { wishlistId: string; ownerEmail: string }) {
  const store = getStore();
  return store.items
    .filter((item) => item.wishlistId === input.wishlistId && item.ownerEmail === input.ownerEmail)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function listPublicItemsForWishlist(input: { wishlistId: string }): PublicItemReadModel[] {
  const store = getStore();

  return store.items
    .filter((item) => item.wishlistId === input.wishlistId && !item.archivedAt)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map((item) => {
      const fundedCents = 0;
      const ratio =
        item.isGroupFunded && item.targetCents && item.targetCents > 0
          ? Math.min(fundedCents, item.targetCents) / item.targetCents
          : 0;

      return {
        id: item.id,
        title: item.title,
        url: item.url,
        imageUrl: item.imageUrl && !isStorageRef(item.imageUrl) ? item.imageUrl : null,
        priceCents: item.priceCents,
        isGroupFunded: item.isGroupFunded,
        targetCents: item.targetCents,
        fundedCents,
        progressRatio: ratio,
        availability: "available",
        updatedAt: item.updatedAt,
      };
    });
}

export function prepareItemImageUpload(input: {
  itemId: string;
  ownerEmail: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  maxBytes: number;
  allowedMimeTypes: string[];
  ttlSeconds: number;
}) {
  const store = getStore();
  const item = store.items.find((candidate) => candidate.id === input.itemId);

  if (!item) {
    return { error: "NOT_FOUND" as PrepareImageUploadError };
  }
  if (item.ownerEmail !== input.ownerEmail) {
    return { error: "FORBIDDEN" as PrepareImageUploadError };
  }
  if (item.archivedAt) {
    return { error: "ARCHIVED" as PrepareImageUploadError };
  }

  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    return { error: "INVALID_SIZE" as PrepareImageUploadError };
  }
  if (input.sizeBytes > input.maxBytes) {
    return { error: "FILE_TOO_LARGE" as PrepareImageUploadError };
  }

  const normalizedMime = input.mimeType.trim().toLowerCase();
  if (!input.allowedMimeTypes.includes(normalizedMime)) {
    return { error: "INVALID_MIME" as PrepareImageUploadError };
  }

  pruneExpiredTickets();

  const path = buildStoragePath({
    ownerEmail: input.ownerEmail,
    wishlistId: item.wishlistId,
    itemId: item.id,
    filename: input.filename,
  });

  const uploadToken = randomUUID();
  store.uploadTickets.push({
    token: uploadToken,
    itemId: item.id,
    ownerEmail: input.ownerEmail,
    path,
    mimeType: normalizedMime,
    maxBytes: input.maxBytes,
    expiresAt: Date.now() + input.ttlSeconds * 1000,
  });

  return {
    uploadToken,
  };
}

export function uploadItemImage(input: {
  uploadToken: string;
  ownerEmail: string;
  mimeType: string;
  fileBytes: Uint8Array;
  ttlSeconds: number;
}) {
  pruneExpiredTickets();

  const store = getStore();
  const ticketIndex = store.uploadTickets.findIndex((ticket) => ticket.token === input.uploadToken);
  if (ticketIndex === -1) {
    return { error: "INVALID_UPLOAD_TOKEN" as UploadItemImageError };
  }

  const ticket = store.uploadTickets[ticketIndex];

  if (ticket.ownerEmail !== input.ownerEmail) {
    return { error: "FORBIDDEN" as UploadItemImageError };
  }

  const normalizedMime = input.mimeType.trim().toLowerCase();
  if (normalizedMime !== ticket.mimeType) {
    return { error: "INVALID_MIME" as UploadItemImageError };
  }

  const sizeBytes = input.fileBytes.byteLength;
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    return { error: "INVALID_SIZE" as UploadItemImageError };
  }
  if (sizeBytes > ticket.maxBytes) {
    return { error: "FILE_TOO_LARGE" as UploadItemImageError };
  }

  const item = store.items.find((candidate) => candidate.id === ticket.itemId);
  if (!item) {
    store.uploadTickets.splice(ticketIndex, 1);
    return { error: "NOT_FOUND" as UploadItemImageError };
  }
  if (item.ownerEmail !== input.ownerEmail) {
    store.uploadTickets.splice(ticketIndex, 1);
    return { error: "FORBIDDEN" as UploadItemImageError };
  }
  if (item.archivedAt) {
    store.uploadTickets.splice(ticketIndex, 1);
    return { error: "ARCHIVED" as UploadItemImageError };
  }

  const existingImageIndex = store.images.findIndex((image) => image.path === ticket.path);
  const nextTimestamp = nowIso();
  const nextImage: StoredImage = {
    path: ticket.path,
    itemId: item.id,
    wishlistId: item.wishlistId,
    ownerEmail: item.ownerEmail,
    contentType: normalizedMime,
    sizeBytes,
    dataBase64: Buffer.from(input.fileBytes).toString("base64"),
    createdAt: existingImageIndex === -1 ? nextTimestamp : store.images[existingImageIndex].createdAt,
    updatedAt: nextTimestamp,
  };

  if (existingImageIndex === -1) {
    store.images.unshift(nextImage);
  } else {
    store.images[existingImageIndex] = nextImage;
  }

  if (item.imageUrl && isStorageRef(item.imageUrl)) {
    const previousPath = parseStoragePath(item.imageUrl);
    if (previousPath !== ticket.path) {
      removeImageByPath(previousPath);
    }
  }

  item.imageUrl = `${STORAGE_PREFIX}${ticket.path}`;
  item.updatedAt = nextTimestamp;
  logAudit("update", item.id, item.ownerEmail);

  store.uploadTickets.splice(ticketIndex, 1);

  const previewToken = createPreviewTicket(item.id, ticket.path, input.ttlSeconds);

  return {
    item,
    previewToken,
  };
}

export function createItemImagePreview(input: { itemId: string; ownerEmail: string; ttlSeconds: number }) {
  const store = getStore();
  const item = store.items.find((candidate) => candidate.id === input.itemId);

  if (!item) {
    return { error: "NOT_FOUND" as CreatePreviewError };
  }
  if (item.ownerEmail !== input.ownerEmail) {
    return { error: "FORBIDDEN" as CreatePreviewError };
  }

  if (!item.imageUrl) {
    return { previewToken: null as string | null, externalUrl: null as string | null };
  }

  if (!isStorageRef(item.imageUrl)) {
    return {
      previewToken: null as string | null,
      externalUrl: item.imageUrl,
    };
  }

  const path = parseStoragePath(item.imageUrl);
  const image = store.images.find((candidate) => candidate.path === path);
  if (!image) {
    return { previewToken: null as string | null, externalUrl: null as string | null };
  }

  const previewToken = createPreviewTicket(item.id, path, input.ttlSeconds);

  return {
    previewToken,
    externalUrl: null as string | null,
  };
}

export function resolveItemImagePreview(input: { itemId: string; previewToken: string }) {
  pruneExpiredTickets();

  const store = getStore();
  const ticket = store.previewTickets.find((candidate) => candidate.token === input.previewToken);

  if (!ticket || ticket.itemId !== input.itemId) {
    return { error: "INVALID_PREVIEW_TOKEN" as ResolvePreviewError };
  }

  const image = store.images.find((candidate) => candidate.path === ticket.path);
  if (!image) {
    return { error: "NOT_FOUND" as ResolvePreviewError };
  }

  return {
    contentType: image.contentType,
    bytes: Buffer.from(image.dataBase64, "base64"),
  };
}
