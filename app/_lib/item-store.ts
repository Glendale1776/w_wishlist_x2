import { createHash, randomUUID } from "node:crypto";

import { getSupabaseAdminClient, getSupabaseStorageBucket } from "@/app/_lib/supabase-admin";

export type ItemRecord = {
  id: string;
  wishlistId: string;
  ownerEmail: string;
  title: string;
  description: string | null;
  url: string | null;
  priceCents: number | null;
  imageUrl: string | null;
  imageUrls: string[];
  isGroupFunded: boolean;
  targetCents: number | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ItemAuditAction = "create" | "update" | "archive" | "reserve" | "unreserve" | "contribute";

export type ItemAuditEvent = {
  id: string;
  action: ItemAuditAction;
  wishlistId: string;
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

export type ReservationRecord = {
  id: string;
  wishlistId: string;
  itemId: string;
  actorEmail: string;
  status: "active" | "released";
  createdAt: string;
  updatedAt: string;
};

export type ContributionRecord = {
  id: string;
  wishlistId: string;
  itemId: string;
  actorEmail: string;
  amountCents: number;
  createdAt: string;
};

type IdempotencyRecord = {
  scope: string;
  actorEmail: string;
  key: string;
  payloadHash: string;
  status: number;
  body: unknown;
  expiresAt: number;
};

type RateLimitWindow = {
  count: number;
  windowStartedAt: number;
};

export type PrepareImageUploadError =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "ARCHIVED"
  | "INVALID_MIME"
  | "FILE_TOO_LARGE"
  | "INVALID_SIZE"
  | "IMAGE_LIMIT_REACHED";

export type UploadItemImageError =
  | "INVALID_UPLOAD_TOKEN"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "ARCHIVED"
  | "INVALID_MIME"
  | "FILE_TOO_LARGE"
  | "INVALID_SIZE"
  | "STORAGE_UPLOAD_FAILED"
  | "IMAGE_LIMIT_REACHED";

export type CreatePreviewError = "NOT_FOUND" | "FORBIDDEN";
export type ResolvePreviewError = "INVALID_PREVIEW_TOKEN" | "NOT_FOUND";

export type ReservationMutationError = "NOT_FOUND" | "ARCHIVED" | "ALREADY_RESERVED" | "NO_ACTIVE_RESERVATION";

export type ContributionMutationError = "NOT_FOUND" | "ARCHIVED" | "NOT_GROUP_FUNDED" | "INVALID_AMOUNT";

export type PublicItemReadModel = {
  id: string;
  title: string;
  description: string | null;
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

export type ActivityEntry = {
  id: string;
  kind: "reservation" | "contribution";
  action: "reserved" | "unreserved" | "contributed";
  wishlistId: string;
  itemId: string;
  itemTitle: string;
  amountCents: number | null;
  status: "active" | "released" | null;
  happenedAt: string;
};

export type IdempotencyReadResult =
  | {
      kind: "miss";
    }
  | {
      kind: "payload_mismatch";
    }
  | {
      kind: "cached";
      status: number;
      body: unknown;
    };

const STORAGE_PREFIX = "storage://";
const RATE_LIMIT_WINDOW_MS = 60_000;
const ITEM_IMAGE_LIMIT = 10;

type ItemStore = {
  items: ItemRecord[];
  auditEvents: ItemAuditEvent[];
  images: StoredImage[];
  uploadTickets: UploadTicket[];
  previewTickets: PreviewTicket[];
  reservations: ReservationRecord[];
  contributions: ContributionRecord[];
  idempotency: IdempotencyRecord[];
  rateLimits: Record<string, RateLimitWindow>;
};

declare global {
  // eslint-disable-next-line no-var
  var __itemStore: Partial<ItemStore> | undefined;
}

function getStore(): ItemStore {
  if (!globalThis.__itemStore) {
    globalThis.__itemStore = {};
  }

  const store = globalThis.__itemStore;

  if (!store.items) store.items = [];
  if (!store.auditEvents) store.auditEvents = [];
  if (!store.images) store.images = [];
  if (!store.uploadTickets) store.uploadTickets = [];
  if (!store.previewTickets) store.previewTickets = [];
  if (!store.reservations) store.reservations = [];
  if (!store.contributions) store.contributions = [];
  if (!store.idempotency) store.idempotency = [];
  if (!store.rateLimits) store.rateLimits = {};

  return store as ItemStore;
}

function nowIso() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
}

function logAudit(action: ItemAuditEvent["action"], entityId: string, ownerEmail: string, wishlistId: string) {
  const store = getStore();
  store.auditEvents.unshift({
    id: randomUUID(),
    action,
    wishlistId,
    entityId,
    ownerEmail,
    createdAt: nowIso(),
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

function isStorageRef(value: string | null | undefined): value is string {
  return Boolean(value && value.startsWith(STORAGE_PREFIX));
}

function parseStoragePath(reference: string): string {
  return reference.slice(STORAGE_PREFIX.length);
}

function getItemImageUrls(item: Pick<ItemRecord, "imageUrl" | "imageUrls">): string[] {
  if (Array.isArray(item.imageUrls) && item.imageUrls.length > 0) {
    return item.imageUrls.filter(Boolean);
  }
  if (item.imageUrl) return [item.imageUrl];
  return [];
}

function normalizeImageUrls(input: Array<string | null | undefined>): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of input) {
    const trimmed = (value || "").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
    if (normalized.length >= ITEM_IMAGE_LIMIT) break;
  }

  return normalized;
}

function removeImageByPath(path: string) {
  const store = getStore();
  store.images = store.images.filter((image) => image.path !== path);
  store.previewTickets = store.previewTickets.filter((ticket) => ticket.path !== path);

  try {
    const supabase = getSupabaseAdminClient();
    const bucket = getSupabaseStorageBucket();
    void supabase.storage.from(bucket).remove([path]);
  } catch {
    // Ignore storage cleanup failures and avoid impacting core item flows.
  }
}

function pruneExpiredTickets(now = nowMs()) {
  const store = getStore();
  store.uploadTickets = store.uploadTickets.filter((ticket) => ticket.expiresAt > now);
  store.previewTickets = store.previewTickets.filter((ticket) => ticket.expiresAt > now);
}

function pruneExpiredIdempotency(now = nowMs()) {
  const store = getStore();
  store.idempotency = store.idempotency.filter((entry) => entry.expiresAt > now);
}

function pruneExpiredRateWindows(now = nowMs()) {
  const store = getStore();
  const keys = Object.keys(store.rateLimits);
  for (const key of keys) {
    const window = store.rateLimits[key];
    if (now - window.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
      delete store.rateLimits[key];
    }
  }
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
    expiresAt: nowMs() + ttlSeconds * 1000,
  });

  return token;
}

function fundedCentsForItem(itemId: string): number {
  const store = getStore();
  return store.contributions
    .filter((contribution) => contribution.itemId === itemId)
    .reduce((sum, contribution) => sum + contribution.amountCents, 0);
}

function activeReservationForItem(itemId: string): ReservationRecord | null {
  const store = getStore();
  const found = store.reservations.find((reservation) => reservation.itemId === itemId && reservation.status === "active");
  return found || null;
}

function buildPublicItemReadModel(item: ItemRecord): PublicItemReadModel {
  const fundedCents = fundedCentsForItem(item.id);
  const activeReservation = activeReservationForItem(item.id);
  const ratio =
    item.isGroupFunded && item.targetCents && item.targetCents > 0
      ? Math.min(fundedCents, item.targetCents) / item.targetCents
      : 0;

  return {
    id: item.id,
    title: item.title,
    description: item.description,
    url: item.url,
    imageUrl: item.imageUrl && !isStorageRef(item.imageUrl) ? item.imageUrl : null,
    priceCents: item.priceCents,
    isGroupFunded: item.isGroupFunded,
    targetCents: item.targetCents,
    fundedCents,
    progressRatio: ratio,
    availability: activeReservation ? "reserved" : "available",
    updatedAt: item.updatedAt,
  };
}

function findActiveReservationForActor(itemId: string, actorEmail: string): ReservationRecord | null {
  const store = getStore();
  const found = store.reservations.find(
    (reservation) => reservation.itemId === itemId && reservation.actorEmail === actorEmail && reservation.status === "active",
  );
  return found || null;
}

function hashPayload(payload: unknown): string {
  const normalized = JSON.stringify(payload ?? null);
  return createHash("sha256").update(normalized).digest("hex");
}

export function createItem(input: {
  wishlistId: string;
  ownerEmail: string;
  title: string;
  description: string | null;
  url: string | null;
  priceCents: number | null;
  imageUrl: string | null;
  imageUrls?: string[] | null;
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

  const normalizedImages = normalizeImageUrls([...(input.imageUrls || []), input.imageUrl]);

  const item: ItemRecord = {
    id: randomUUID(),
    wishlistId: input.wishlistId,
    ownerEmail: input.ownerEmail,
    title: input.title,
    description: input.description,
    url: input.url,
    priceCents: input.priceCents,
    imageUrl: normalizedImages[0] || null,
    imageUrls: normalizedImages,
    isGroupFunded: input.isGroupFunded,
    targetCents: input.targetCents,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const store = getStore();
  store.items.unshift(item);
  logAudit("create", item.id, input.ownerEmail, item.wishlistId);

  return {
    item,
    duplicateUrl,
  };
}

export function updateItem(input: {
  itemId: string;
  ownerEmail: string;
  title: string;
  description: string | null;
  url: string | null;
  priceCents: number | null;
  imageUrl: string | null;
  imageUrls?: string[] | null;
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

  const previousImageUrls = getItemImageUrls(found);
  const nextImageUrls = normalizeImageUrls(
    input.imageUrls ? [...input.imageUrls] : [input.imageUrl],
  );

  found.title = input.title;
  found.description = input.description;
  found.url = input.url;
  found.priceCents = input.priceCents;
  found.imageUrls = nextImageUrls;
  found.imageUrl = nextImageUrls[0] || null;
  found.isGroupFunded = input.isGroupFunded;
  found.targetCents = input.targetCents;
  found.updatedAt = nowIso();

  const nextSet = new Set(nextImageUrls.filter(isStorageRef).map((value) => parseStoragePath(value)));
  for (const previousImageUrl of previousImageUrls) {
    if (!isStorageRef(previousImageUrl)) continue;
    const previousPath = parseStoragePath(previousImageUrl);
    if (!nextSet.has(previousPath)) {
      removeImageByPath(previousPath);
    }
  }

  logAudit("update", found.id, input.ownerEmail, found.wishlistId);

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
    logAudit("archive", found.id, input.ownerEmail, found.wishlistId);
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
    .map((item) => buildPublicItemReadModel(item));
}

export function reservePublicItem(input: { wishlistId: string; itemId: string; actorEmail: string }) {
  const store = getStore();
  const item = store.items.find((candidate) => candidate.id === input.itemId && candidate.wishlistId === input.wishlistId);

  if (!item) {
    return { error: "NOT_FOUND" as ReservationMutationError };
  }

  if (item.archivedAt) {
    return { error: "ARCHIVED" as ReservationMutationError };
  }

  const existingActive = activeReservationForItem(item.id);
  if (existingActive) {
    if (existingActive.actorEmail !== input.actorEmail) {
      return { error: "ALREADY_RESERVED" as ReservationMutationError };
    }

    return {
      reservationStatus: "active" as const,
      item: buildPublicItemReadModel(item),
      idempotent: true,
    };
  }

  const now = nowIso();
  const existingReleased = store.reservations.find(
    (reservation) =>
      reservation.itemId === item.id && reservation.actorEmail === input.actorEmail && reservation.status === "released",
  );

  if (existingReleased) {
    existingReleased.status = "active";
    existingReleased.updatedAt = now;
  } else {
    store.reservations.unshift({
      id: randomUUID(),
      wishlistId: item.wishlistId,
      itemId: item.id,
      actorEmail: input.actorEmail,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }

  item.updatedAt = now;
  logAudit("reserve", item.id, input.actorEmail, item.wishlistId);

  return {
    reservationStatus: "active" as const,
    item: buildPublicItemReadModel(item),
    idempotent: false,
  };
}

export function unreservePublicItem(input: { wishlistId: string; itemId: string; actorEmail: string }) {
  const store = getStore();
  const item = store.items.find((candidate) => candidate.id === input.itemId && candidate.wishlistId === input.wishlistId);

  if (!item) {
    return { error: "NOT_FOUND" as ReservationMutationError };
  }

  if (item.archivedAt) {
    return { error: "ARCHIVED" as ReservationMutationError };
  }

  const actorReservation = findActiveReservationForActor(item.id, input.actorEmail);
  if (!actorReservation) {
    return { error: "NO_ACTIVE_RESERVATION" as ReservationMutationError };
  }

  actorReservation.status = "released";
  actorReservation.updatedAt = nowIso();

  item.updatedAt = actorReservation.updatedAt;
  logAudit("unreserve", item.id, input.actorEmail, item.wishlistId);

  return {
    reservationStatus: "released" as const,
    item: buildPublicItemReadModel(item),
  };
}

export function contributeToPublicItem(input: {
  wishlistId: string;
  itemId: string;
  actorEmail: string;
  amountCents: number;
}) {
  const store = getStore();
  const item = store.items.find((candidate) => candidate.id === input.itemId && candidate.wishlistId === input.wishlistId);

  if (!item) {
    return { error: "NOT_FOUND" as ContributionMutationError };
  }

  if (item.archivedAt) {
    return { error: "ARCHIVED" as ContributionMutationError };
  }

  if (!item.isGroupFunded) {
    return { error: "NOT_GROUP_FUNDED" as ContributionMutationError };
  }

  if (!Number.isInteger(input.amountCents) || input.amountCents < 100) {
    return { error: "INVALID_AMOUNT" as ContributionMutationError };
  }

  const contribution: ContributionRecord = {
    id: randomUUID(),
    wishlistId: item.wishlistId,
    itemId: item.id,
    actorEmail: input.actorEmail,
    amountCents: input.amountCents,
    createdAt: nowIso(),
  };

  store.contributions.unshift(contribution);
  item.updatedAt = contribution.createdAt;
  logAudit("contribute", item.id, input.actorEmail, item.wishlistId);

  return {
    contribution,
    item: buildPublicItemReadModel(item),
  };
}

export function listActivityForActor(input: { actorEmail: string }): ActivityEntry[] {
  const store = getStore();
  const itemTitleById = new Map(store.items.map((item) => [item.id, item.title]));

  const reservationEntries: ActivityEntry[] = store.reservations
    .filter((reservation) => reservation.actorEmail === input.actorEmail)
    .map((reservation) => ({
      id: `res-${reservation.id}`,
      kind: "reservation",
      action: reservation.status === "active" ? "reserved" : "unreserved",
      wishlistId: reservation.wishlistId,
      itemId: reservation.itemId,
      itemTitle: itemTitleById.get(reservation.itemId) || "Untitled item",
      amountCents: null,
      status: reservation.status,
      happenedAt: reservation.updatedAt,
    }));

  const contributionEntries: ActivityEntry[] = store.contributions
    .filter((contribution) => contribution.actorEmail === input.actorEmail)
    .map((contribution) => ({
      id: `con-${contribution.id}`,
      kind: "contribution",
      action: "contributed",
      wishlistId: contribution.wishlistId,
      itemId: contribution.itemId,
      itemTitle: itemTitleById.get(contribution.itemId) || "Untitled item",
      amountCents: contribution.amountCents,
      status: null,
      happenedAt: contribution.createdAt,
    }));

  return [...reservationEntries, ...contributionEntries].sort(
    (a, b) => new Date(b.happenedAt).getTime() - new Date(a.happenedAt).getTime(),
  );
}

export function readIdempotency(input: {
  scope: string;
  actorEmail: string;
  key: string;
  payload: unknown;
}): IdempotencyReadResult {
  pruneExpiredIdempotency();

  const store = getStore();
  const payloadHash = hashPayload(input.payload);
  const existing = store.idempotency.find(
    (entry) => entry.scope === input.scope && entry.actorEmail === input.actorEmail && entry.key === input.key,
  );

  if (!existing) {
    return { kind: "miss" };
  }

  if (existing.payloadHash !== payloadHash) {
    return { kind: "payload_mismatch" };
  }

  return {
    kind: "cached",
    status: existing.status,
    body: existing.body,
  };
}

export function writeIdempotency(input: {
  scope: string;
  actorEmail: string;
  key: string;
  payload: unknown;
  status: number;
  body: unknown;
  ttlSec: number;
}) {
  pruneExpiredIdempotency();

  const store = getStore();
  const payloadHash = hashPayload(input.payload);

  store.idempotency = store.idempotency.filter(
    (entry) => !(entry.scope === input.scope && entry.actorEmail === input.actorEmail && entry.key === input.key),
  );

  store.idempotency.push({
    scope: input.scope,
    actorEmail: input.actorEmail,
    key: input.key,
    payloadHash,
    status: input.status,
    body: input.body,
    expiresAt: nowMs() + input.ttlSec * 1000,
  });
}

export function consumeActionRateLimit(input: {
  scope: string;
  actorEmail: string;
  ipAddress: string;
  limitPerMin: number;
}): { ok: true } | { ok: false; retryAfterSec: number } {
  pruneExpiredRateWindows();

  const store = getStore();
  const now = nowMs();
  const key = `${input.scope}:${input.actorEmail}:${input.ipAddress}`;
  const existing = store.rateLimits[key];

  if (!existing) {
    store.rateLimits[key] = {
      count: 1,
      windowStartedAt: now,
    };
    return { ok: true };
  }

  const elapsed = now - existing.windowStartedAt;
  if (elapsed >= RATE_LIMIT_WINDOW_MS) {
    store.rateLimits[key] = {
      count: 1,
      windowStartedAt: now,
    };
    return { ok: true };
  }

  if (existing.count >= input.limitPerMin) {
    const retryAfterSec = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000));
    return { ok: false, retryAfterSec };
  }

  existing.count += 1;
  return { ok: true };
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
  if (getItemImageUrls(item).length >= ITEM_IMAGE_LIMIT) {
    return { error: "IMAGE_LIMIT_REACHED" as PrepareImageUploadError };
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
    expiresAt: nowMs() + input.ttlSeconds * 1000,
  });

  return {
    uploadToken,
  };
}

export async function uploadItemImage(input: {
  uploadToken: string;
  ownerEmail: string;
  mimeType: string;
  fileBytes: Uint8Array;
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
  if (getItemImageUrls(item).length >= ITEM_IMAGE_LIMIT) {
    store.uploadTickets.splice(ticketIndex, 1);
    return { error: "IMAGE_LIMIT_REACHED" as UploadItemImageError };
  }

  const supabase = getSupabaseAdminClient();
  const bucket = getSupabaseStorageBucket();

  const { error: uploadError } = await supabase.storage.from(bucket).upload(ticket.path, input.fileBytes, {
    contentType: normalizedMime,
    upsert: true,
  });
  if (uploadError) {
    return { error: "STORAGE_UPLOAD_FAILED" as UploadItemImageError };
  }

  const previousImageUrls = getItemImageUrls(item);
  const previousStoragePath = item.imageUrl && isStorageRef(item.imageUrl) ? parseStoragePath(item.imageUrl) : null;
  const nextImageUrls = normalizeImageUrls([...previousImageUrls, `${STORAGE_PREFIX}${ticket.path}`]);

  const nextTimestamp = nowIso();
  item.imageUrls = nextImageUrls;
  item.imageUrl = nextImageUrls[0] || null;
  item.updatedAt = nextTimestamp;
  logAudit("update", item.id, item.ownerEmail, item.wishlistId);

  store.uploadTickets.splice(ticketIndex, 1);

  return {
    item,
    storagePath: ticket.path,
    previousStoragePath,
  };
}

export function createItemImagePreview(input: { itemId: string; ownerEmail: string; imageIndex?: number }) {
  const store = getStore();
  const item = store.items.find((candidate) => candidate.id === input.itemId);

  if (!item) {
    return { error: "NOT_FOUND" as CreatePreviewError };
  }
  if (item.ownerEmail !== input.ownerEmail) {
    return { error: "FORBIDDEN" as CreatePreviewError };
  }

  const imageRefs = getItemImageUrls(item);
  const requestedIndex = Number.isInteger(input.imageIndex) && input.imageIndex !== undefined && input.imageIndex >= 0 ? input.imageIndex : 0;
  const candidateRef = imageRefs[requestedIndex] || null;
  if (!candidateRef) {
    return {
      externalUrl: null as string | null,
      storagePath: null as string | null,
    };
  }

  if (!isStorageRef(candidateRef)) {
    return {
      externalUrl: candidateRef,
      storagePath: null as string | null,
    };
  }

  const path = parseStoragePath(candidateRef);
  return {
    externalUrl: null as string | null,
    storagePath: path,
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

export function listItemAuditEvents(input: {
  wishlistId?: string;
  action?: ItemAuditAction;
  since?: string;
  limit?: number;
}) {
  const store = getStore();
  const sinceTime = input.since ? new Date(input.since).getTime() : Number.NEGATIVE_INFINITY;
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);

  return store.auditEvents
    .filter((event) => {
      if (input.wishlistId && event.wishlistId !== input.wishlistId) return false;
      if (input.action && event.action !== input.action) return false;
      if (new Date(event.createdAt).getTime() < sinceTime) return false;
      return true;
    })
    .slice(0, limit);
}

export function pruneItemAuditEvents(input: { retentionDays: number }) {
  const safeRetentionDays = Math.min(Math.max(Math.floor(input.retentionDays), 1), 3650);
  const cutoffMs = Date.now() - safeRetentionDays * 24 * 60 * 60 * 1000;
  const store = getStore();
  const before = store.auditEvents.length;
  store.auditEvents = store.auditEvents.filter((event) => new Date(event.createdAt).getTime() >= cutoffMs);
  return {
    removedCount: before - store.auditEvents.length,
    retentionDays: safeRetentionDays,
  };
}

export function deleteItemsForWishlist(input: { wishlistId: string; ownerEmail: string }) {
  const store = getStore();
  const itemIds = new Set(
    store.items
      .filter((item) => item.wishlistId === input.wishlistId && item.ownerEmail === input.ownerEmail)
      .map((item) => item.id),
  );

  if (itemIds.size === 0) {
    return { deletedCount: 0 };
  }

  for (const item of store.items) {
    if (!itemIds.has(item.id)) continue;
    for (const imageRef of getItemImageUrls(item)) {
      if (isStorageRef(imageRef)) {
        removeImageByPath(parseStoragePath(imageRef));
      }
    }
  }

  store.items = store.items.filter((item) => !itemIds.has(item.id));
  store.images = store.images.filter((image) => !itemIds.has(image.itemId));
  store.uploadTickets = store.uploadTickets.filter((ticket) => !itemIds.has(ticket.itemId));
  store.previewTickets = store.previewTickets.filter((ticket) => !itemIds.has(ticket.itemId));
  store.reservations = store.reservations.filter((reservation) => !itemIds.has(reservation.itemId));
  store.contributions = store.contributions.filter((contribution) => !itemIds.has(contribution.itemId));
  store.auditEvents = store.auditEvents.filter(
    (event) => event.wishlistId !== input.wishlistId && !itemIds.has(event.entityId),
  );

  return { deletedCount: itemIds.size };
}
