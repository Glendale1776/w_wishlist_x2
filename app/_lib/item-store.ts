import { createHash, randomUUID } from "node:crypto";

import { processArchivedReservationNotifications } from "@/app/_lib/archive-alerts";
import { getSupabaseAdminClient, getSupabaseStorageBucket } from "@/app/_lib/supabase-admin";
import { listWishlistRecords } from "@/app/_lib/wishlist-store";

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
  fundedCents: number;
  contributorCount: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ItemRow = {
  id: string;
  wishlist_id: string;
  title: string;
  description: string | null;
  url: string | null;
  price_cents: number | null;
  image_url: string | null;
  image_urls: string[] | null;
  is_group_funded: boolean;
  target_cents: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type ReservationRow = {
  id: string;
  wishlist_id: string;
  item_id: string;
  user_id: string;
  status: "active" | "released";
  created_at: string;
  updated_at: string;
};

type ContributionRow = {
  id: string;
  item_id: string;
  user_id: string;
  amount_cents: number;
  created_at: string;
};

type WishlistOpenRow = {
  id: string;
  wishlist_id: string;
  user_id: string;
  first_opened_at: string;
  last_opened_at: string;
  open_count: number;
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

export type ReservationMutationError = "NOT_FOUND" | "ARCHIVED" | "ALREADY_RESERVED" | "NO_ACTIVE_RESERVATION" | "ACTOR_NOT_FOUND";

export type ContributionMutationError = "NOT_FOUND" | "ARCHIVED" | "NOT_GROUP_FUNDED" | "INVALID_AMOUNT" | "ACTOR_NOT_FOUND";

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
  contributorCount: number;
  progressRatio: number;
  availability: "available" | "reserved";
  updatedAt: string;
};

export type ActivityEntry = {
  id: string;
  kind: "reservation" | "contribution" | "visit";
  action: "reserved" | "unreserved" | "contributed" | "opened_wishlist";
  wishlistId: string;
  itemId: string | null;
  itemTitle: string | null;
  amountCents: number | null;
  status: "active" | "released" | null;
  openCount: number | null;
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
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ItemStore = {
  items: ItemRecord[];
  auditEvents: ItemAuditEvent[];
  images: StoredImage[];
  uploadTickets: UploadTicket[];
  previewTickets: PreviewTicket[];
  reservations: ReservationRecord[];
  contributions: ContributionRecord[];
  authUserIdByEmail: Record<string, string | null>;
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
  if (!store.authUserIdByEmail) store.authUserIdByEmail = {};
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

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function normalizeEmail(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function publicImageSignedUrlTtlSec(): number {
  const parsed = parsePositiveInt(process.env.PUBLIC_IMAGE_SIGNED_URL_TTL_SEC, 3600);
  return Math.min(Math.max(parsed, 60), 86400);
}

function itemSelectColumns() {
  return [
    "id",
    "wishlist_id",
    "title",
    "description",
    "url",
    "price_cents",
    "image_url",
    "image_urls",
    "is_group_funded",
    "target_cents",
    "archived_at",
    "created_at",
    "updated_at",
  ].join(",");
}

function reservationSelectColumns() {
  return ["id", "wishlist_id", "item_id", "user_id", "status", "created_at", "updated_at"].join(",");
}

function contributionSelectColumns() {
  return ["id", "item_id", "user_id", "amount_cents", "created_at"].join(",");
}

function wishlistOpenSelectColumns() {
  return ["id", "wishlist_id", "user_id", "first_opened_at", "last_opened_at", "open_count"].join(",");
}

async function resolveActorUserId(actorEmail: string): Promise<string | null> {
  const normalizedEmail = normalizeEmail(actorEmail);
  if (!EMAIL_REGEX.test(normalizedEmail)) return null;

  const store = getStore();
  if (Object.prototype.hasOwnProperty.call(store.authUserIdByEmail, normalizedEmail)) {
    return store.authUserIdByEmail[normalizedEmail] || null;
  }

  const supabase = getSupabaseAdminClient();
  const perPage = 200;
  let page = 1;

  for (let guard = 0; guard < 200; guard += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) break;

    const users = data?.users || [];
    const found = users.find((candidate) => normalizeEmail(candidate.email) === normalizedEmail);
    if (found?.id) {
      store.authUserIdByEmail[normalizedEmail] = found.id;
      return found.id;
    }

    if (!data?.nextPage || users.length === 0) break;
    page = data.nextPage;
  }

  store.authUserIdByEmail[normalizedEmail] = null;
  return null;
}

function mapItemRowToRecord(row: ItemRow, ownerEmail: string): ItemRecord {
  const normalizedImages = normalizeImageUrls([...(row.image_urls || []), row.image_url]);
  return {
    id: row.id,
    wishlistId: row.wishlist_id,
    ownerEmail,
    title: row.title,
    description: row.description,
    url: row.url,
    priceCents: row.price_cents,
    imageUrl: normalizedImages[0] || null,
    imageUrls: normalizedImages,
    isGroupFunded: row.is_group_funded,
    targetCents: row.target_cents,
    fundedCents: 0,
    contributorCount: 0,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function upsertCachedItem(next: ItemRecord) {
  const store = getStore();
  const existingIndex = store.items.findIndex((item) => item.id === next.id);
  if (existingIndex === -1) {
    store.items.unshift(next);
    return;
  }
  store.items[existingIndex] = next;
}

function removeCachedItems(itemIds: Set<string>) {
  if (itemIds.size === 0) return;
  const store = getStore();
  store.items = store.items.filter((item) => !itemIds.has(item.id));
  store.images = store.images.filter((image) => !itemIds.has(image.itemId));
  store.uploadTickets = store.uploadTickets.filter((ticket) => !itemIds.has(ticket.itemId));
  store.previewTickets = store.previewTickets.filter((ticket) => !itemIds.has(ticket.itemId));
  store.reservations = store.reservations.filter((reservation) => !itemIds.has(reservation.itemId));
  store.contributions = store.contributions.filter((contribution) => !itemIds.has(contribution.itemId));
  store.auditEvents = store.auditEvents.filter((event) => !itemIds.has(event.entityId));
}

async function hasOwnerAccessToWishlist(ownerEmail: string, wishlistId: string): Promise<boolean> {
  const wishlists = await listWishlistRecords({
    ownerEmail,
    search: "",
    sort: "updated_desc",
    canonicalHost: process.env.CANONICAL_HOST,
  });
  return wishlists.some((wishlist) => wishlist.id === wishlistId);
}

async function listItemRowsByWishlist(wishlistId: string): Promise<ItemRow[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("items")
    .select(itemSelectColumns())
    .eq("wishlist_id", wishlistId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data || []) as unknown as ItemRow[];
}

async function listActiveReservedItemIds(itemIds: string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set<string>();

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("reservations")
    .select("item_id")
    .eq("status", "active")
    .in("item_id", itemIds);

  if (error) throw error;

  const reservedIds = new Set<string>();
  for (const row of (data || []) as Array<{ item_id: string }>) {
    if (row.item_id) reservedIds.add(row.item_id);
  }
  return reservedIds;
}

async function listContributionRowsByItemIds(itemIds: string[]): Promise<ContributionRow[]> {
  if (itemIds.length === 0) return [];

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("contributions")
    .select(contributionSelectColumns())
    .in("item_id", itemIds);

  if (error) throw error;
  return (data || []) as unknown as ContributionRow[];
}

async function findActiveReservationRowForItem(itemId: string): Promise<ReservationRow | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("reservations")
    .select(reservationSelectColumns())
    .eq("item_id", itemId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  if (!data) return null;
  return data as unknown as ReservationRow;
}

async function findLatestReleasedReservationRowForActor(input: {
  itemId: string;
  actorUserId: string;
}): Promise<ReservationRow | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("reservations")
    .select(reservationSelectColumns())
    .eq("item_id", input.itemId)
    .eq("user_id", input.actorUserId)
    .eq("status", "released")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  if (!data) return null;
  return data as unknown as ReservationRow;
}

async function findActiveReservationRowForActor(input: {
  itemId: string;
  actorUserId: string;
}): Promise<ReservationRow | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("reservations")
    .select(reservationSelectColumns())
    .eq("item_id", input.itemId)
    .eq("user_id", input.actorUserId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  if (!data) return null;
  return data as unknown as ReservationRow;
}

async function touchItemUpdatedAt(itemId: string, updatedAt: string): Promise<ItemRecord | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("items")
    .update({ updated_at: updatedAt })
    .eq("id", itemId)
    .select(itemSelectColumns())
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const item = mapItemRowToRecord(data as unknown as ItemRow, "");
  upsertCachedItem(item);
  return item;
}

async function findPublicItemForMutation(input: { wishlistId: string; itemId: string }): Promise<ItemRecord | { error: "NOT_FOUND" | "ARCHIVED" }> {
  const row = await findItemRowById(input.itemId);
  if (!row || row.wishlist_id !== input.wishlistId) {
    return { error: "NOT_FOUND" as const };
  }

  const item = mapItemRowToRecord(row, "");
  upsertCachedItem(item);

  if (item.archivedAt) {
    return { error: "ARCHIVED" as const };
  }

  return item;
}

async function findItemRowById(itemId: string): Promise<ItemRow | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("items")
    .select(itemSelectColumns())
    .eq("id", itemId)
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  if (!data) return null;
  return data as unknown as ItemRow;
}

async function findOwnedItem(input: { itemId: string; ownerEmail: string }): Promise<ItemRecord | { error: "NOT_FOUND" | "FORBIDDEN" }> {
  const row = await findItemRowById(input.itemId);
  if (!row) {
    return { error: "NOT_FOUND" as const };
  }

  const hasAccess = await hasOwnerAccessToWishlist(input.ownerEmail, row.wishlist_id);
  if (!hasAccess) {
    return { error: "FORBIDDEN" as const };
  }

  const record = mapItemRowToRecord(row, input.ownerEmail);
  upsertCachedItem(record);
  return record;
}

async function findDuplicateUrlInWishlist(input: {
  wishlistId: string;
  normalizedUrl: string;
  ignoreItemId?: string;
}): Promise<boolean> {
  const rows = await listItemRowsByWishlist(input.wishlistId);
  return rows.some((row) => {
    if (row.archived_at) return false;
    if (input.ignoreItemId && row.id === input.ignoreItemId) return false;
    return (row.url || "").trim().toLowerCase() === input.normalizedUrl;
  });
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

function upgradeExternalImageUrlQuality(value: string): string {
  if (isStorageRef(value)) return value;

  try {
    const parsed = new URL(value);
    if (parsed.hostname.toLowerCase() !== "m.media-amazon.com") return value;
    if (!/\/images\/i\//i.test(parsed.pathname)) return value;

    // Strip Amazon thumbnail/preview size modifiers, e.g. ._AC_US100_.jpg
    parsed.pathname = parsed.pathname.replace(/\._[^/]+_\.(jpe?g|png|webp)$/i, ".$1");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value;
  }
}

function getItemImageUrls(item: Pick<ItemRecord, "imageUrl" | "imageUrls">): string[] {
  if (Array.isArray(item.imageUrls) && item.imageUrls.length > 0) {
    const normalized = item.imageUrls.filter(Boolean);
    if (normalized.length > 0) return normalized;
  }
  if (item.imageUrl) return [item.imageUrl];
  return [];
}

function normalizeImageUrls(input: Array<string | null | undefined>): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of input) {
    const trimmed = upgradeExternalImageUrlQuality((value || "").trim());
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

function contributorCountForItem(itemId: string): number {
  const store = getStore();
  const contributorEmails = new Set(
    store.contributions
      .filter((contribution) => contribution.itemId === itemId)
      .map((contribution) => normalizeEmail(contribution.actorEmail)),
  );
  contributorEmails.delete("");
  return contributorEmails.size;
}

type ContributionStats = {
  fundedCents: number;
  contributorCount: number;
};

function buildContributionStatsByItem(rows: ContributionRow[]): Map<string, ContributionStats> {
  const totalsByItem = new Map<string, { fundedCents: number; contributorUserIds: Set<string> }>();

  for (const row of rows) {
    if (!row.item_id) continue;
    const current = totalsByItem.get(row.item_id) || {
      fundedCents: 0,
      contributorUserIds: new Set<string>(),
    };

    current.fundedCents += Number.isFinite(row.amount_cents) ? row.amount_cents : 0;
    if (row.user_id) current.contributorUserIds.add(row.user_id);
    totalsByItem.set(row.item_id, current);
  }

  const statsByItem = new Map<string, ContributionStats>();
  for (const [itemId, totals] of totalsByItem.entries()) {
    statsByItem.set(itemId, {
      fundedCents: totals.fundedCents,
      contributorCount: totals.contributorUserIds.size,
    });
  }

  return statsByItem;
}

function activeReservationForItem(itemId: string): ReservationRecord | null {
  const store = getStore();
  const found = store.reservations.find((reservation) => reservation.itemId === itemId && reservation.status === "active");
  return found || null;
}

function buildPublicItemReadModel(
  item: ItemRecord,
  options?: {
    availability?: "available" | "reserved";
    fundedCents?: number;
    contributorCount?: number;
  },
): PublicItemReadModel {
  const fundedCents = options?.fundedCents ?? fundedCentsForItem(item.id);
  const contributorCount = options?.contributorCount ?? contributorCountForItem(item.id);
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
    imageUrl: item.imageUrl,
    priceCents: item.priceCents,
    isGroupFunded: item.isGroupFunded,
    targetCents: item.targetCents,
    fundedCents,
    contributorCount,
    progressRatio: ratio,
    availability: options?.availability || (activeReservation ? "reserved" : "available"),
    updatedAt: item.updatedAt,
  };
}

export async function hydratePublicItemImage(item: PublicItemReadModel): Promise<PublicItemReadModel> {
  if (!item.imageUrl) return item;
  if (!isStorageRef(item.imageUrl)) return item;

  const path = parseStoragePath(item.imageUrl);
  if (!path) {
    return { ...item, imageUrl: null };
  }

  try {
    const supabase = getSupabaseAdminClient();
    const bucket = getSupabaseStorageBucket();
    const { data, error } = await supabase
      .storage
      .from(bucket)
      .createSignedUrl(path, publicImageSignedUrlTtlSec());

    if (error || !data?.signedUrl) {
      return { ...item, imageUrl: null };
    }

    return {
      ...item,
      imageUrl: data.signedUrl,
    };
  } catch {
    return { ...item, imageUrl: null };
  }
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

export async function createItem(input: {
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
    ? await findDuplicateUrlInWishlist({
        wishlistId: input.wishlistId,
        normalizedUrl,
      })
    : false;

  const normalizedImages = normalizeImageUrls([...(input.imageUrls || []), input.imageUrl]);
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from("items")
    .insert({
      wishlist_id: input.wishlistId,
      title: input.title,
      description: input.description,
      url: input.url,
      price_cents: input.priceCents,
      image_url: normalizedImages[0] || null,
      image_urls: normalizedImages,
      is_group_funded: input.isGroupFunded,
      target_cents: input.targetCents,
      archived_at: null,
      updated_at: now,
    })
    .select(itemSelectColumns())
    .single();

  if (error || !data) {
    throw error || new Error("Unable to create item.");
  }

  const item = mapItemRowToRecord(data as unknown as ItemRow, input.ownerEmail);
  upsertCachedItem(item);
  logAudit("create", item.id, input.ownerEmail, item.wishlistId);

  return {
    item,
    duplicateUrl,
  };
}

export async function updateItem(input: {
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
  const owned = await findOwnedItem({
    itemId: input.itemId,
    ownerEmail: input.ownerEmail,
  });

  if ("error" in owned) return { error: owned.error };

  const normalizedUrl = (input.url || "").trim().toLowerCase();
  const duplicateUrl = normalizedUrl
    ? await findDuplicateUrlInWishlist({
        wishlistId: owned.wishlistId,
        normalizedUrl,
        ignoreItemId: owned.id,
      })
    : false;

  const previousImageUrls = getItemImageUrls(owned);
  const nextImageUrls = normalizeImageUrls(input.imageUrls ? [...input.imageUrls] : [input.imageUrl]);
  const nextUpdatedAt = nowIso();

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("items")
    .update({
      title: input.title,
      description: input.description,
      url: input.url,
      price_cents: input.priceCents,
      image_url: nextImageUrls[0] || null,
      image_urls: nextImageUrls,
      is_group_funded: input.isGroupFunded,
      target_cents: input.targetCents,
      updated_at: nextUpdatedAt,
    })
    .eq("id", owned.id)
    .select(itemSelectColumns())
    .single();

  if (error || !data) {
    throw error || new Error("Unable to update item.");
  }

  const item = mapItemRowToRecord(data as unknown as ItemRow, input.ownerEmail);
  upsertCachedItem(item);

  const nextSet = new Set(nextImageUrls.filter(isStorageRef).map((value) => parseStoragePath(value)));
  for (const previousImageUrl of previousImageUrls) {
    if (!isStorageRef(previousImageUrl)) continue;
    const previousPath = parseStoragePath(previousImageUrl);
    if (!nextSet.has(previousPath)) {
      removeImageByPath(previousPath);
    }
  }

  logAudit("update", item.id, input.ownerEmail, item.wishlistId);

  return {
    item,
    duplicateUrl,
  };
}

export async function archiveItem(input: { itemId: string; ownerEmail: string }) {
  const owned = await findOwnedItem({
    itemId: input.itemId,
    ownerEmail: input.ownerEmail,
  });
  if ("error" in owned) return { error: owned.error };

  if (owned.archivedAt) {
    return {
      item: owned,
    };
  }

  const archivedAt = nowIso();
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("items")
    .update({
      archived_at: archivedAt,
      updated_at: archivedAt,
    })
    .eq("id", owned.id)
    .select(itemSelectColumns())
    .single();

  if (error || !data) {
    throw error || new Error("Unable to archive item.");
  }

  const item = mapItemRowToRecord(data as unknown as ItemRow, input.ownerEmail);
  upsertCachedItem(item);
  logAudit("archive", item.id, input.ownerEmail, item.wishlistId);

  try {
    await processArchivedReservationNotifications({
      wishlistId: item.wishlistId,
      itemId: item.id,
      archivedAt,
      archivedItemTitle: item.title,
      archivedItemPriceCents: item.priceCents,
    });

    const store = getStore();
    store.reservations = store.reservations.map((reservation) =>
      reservation.itemId === item.id && reservation.status === "active"
        ? {
            ...reservation,
            status: "released",
            updatedAt: archivedAt,
          }
        : reservation,
    );
  } catch (error) {
    console.warn("archive_notification_failed", {
      itemId: item.id,
      wishlistId: item.wishlistId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  return {
    item,
  };
}

export async function restoreArchivedItem(input: { itemId: string; ownerEmail: string }) {
  const owned = await findOwnedItem({
    itemId: input.itemId,
    ownerEmail: input.ownerEmail,
  });
  if ("error" in owned) return { error: owned.error };

  if (!owned.archivedAt) {
    return {
      item: owned,
    };
  }

  const restoredAt = nowIso();
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("items")
    .update({
      archived_at: null,
      updated_at: restoredAt,
    })
    .eq("id", owned.id)
    .select(itemSelectColumns())
    .single();

  if (error || !data) {
    throw error || new Error("Unable to restore item.");
  }

  const item = mapItemRowToRecord(data as unknown as ItemRow, input.ownerEmail);
  upsertCachedItem(item);
  logAudit("update", item.id, input.ownerEmail, item.wishlistId);

  return {
    item,
  };
}

export async function listItemsForWishlist(input: { wishlistId: string; ownerEmail: string }) {
  const hasAccess = await hasOwnerAccessToWishlist(input.ownerEmail, input.wishlistId);
  if (!hasAccess) return [];

  const rows = await listItemRowsByWishlist(input.wishlistId);
  const items = rows.map((row) => mapItemRowToRecord(row, input.ownerEmail));
  const contributionRows = await listContributionRowsByItemIds(items.map((item) => item.id));
  const statsByItem = buildContributionStatsByItem(contributionRows);
  const hydratedItems = items.map((item) => {
    const stats = statsByItem.get(item.id);
    if (!stats) return item;
    return {
      ...item,
      fundedCents: stats.fundedCents,
      contributorCount: stats.contributorCount,
    };
  });

  const store = getStore();
  store.items = store.items.filter(
    (item) => !(item.wishlistId === input.wishlistId && item.ownerEmail === input.ownerEmail),
  );
  store.items.unshift(...hydratedItems);

  return hydratedItems;
}

export async function listPublicItemsForWishlist(input: { wishlistId: string }): Promise<PublicItemReadModel[]> {
  const rows = await listItemRowsByWishlist(input.wishlistId);
  const activeItems = rows
    .filter((row) => !row.archived_at)
    .map((row) => mapItemRowToRecord(row, ""));

  for (const item of activeItems) {
    upsertCachedItem(item);
  }

  const contributionRows = await listContributionRowsByItemIds(activeItems.map((item) => item.id));
  const statsByItem = buildContributionStatsByItem(contributionRows);
  const reservedItemIds = await listActiveReservedItemIds(activeItems.map((item) => item.id));
  const baseModels = activeItems.map((item) =>
    buildPublicItemReadModel(item, {
      availability: reservedItemIds.has(item.id) ? "reserved" : "available",
      fundedCents: statsByItem.get(item.id)?.fundedCents ?? 0,
      contributorCount: statsByItem.get(item.id)?.contributorCount ?? 0,
    }),
  );
  return Promise.all(baseModels.map((item) => hydratePublicItemImage(item)));
}

export async function reservePublicItem(input: { wishlistId: string; itemId: string; actorEmail: string }) {
  const actorUserId = await resolveActorUserId(input.actorEmail);
  if (!actorUserId) {
    return { error: "ACTOR_NOT_FOUND" as ReservationMutationError };
  }

  const itemLookup = await findPublicItemForMutation({
    wishlistId: input.wishlistId,
    itemId: input.itemId,
  });
  if ("error" in itemLookup) {
    return { error: itemLookup.error as ReservationMutationError };
  }

  let item = itemLookup;
  const existingActive = await findActiveReservationRowForItem(item.id);
  if (existingActive) {
    if (existingActive.user_id !== actorUserId) {
      return { error: "ALREADY_RESERVED" as ReservationMutationError };
    }

    return {
      reservationStatus: "active" as const,
      item: buildPublicItemReadModel(item, { availability: "reserved" }),
      idempotent: true,
    };
  }

  const now = nowIso();
  const existingReleased = await findLatestReleasedReservationRowForActor({
    itemId: item.id,
    actorUserId,
  });
  const supabase = getSupabaseAdminClient();

  try {
    if (existingReleased) {
      const { error } = await supabase
        .from("reservations")
        .update({
          status: "active",
          updated_at: now,
        })
        .eq("id", existingReleased.id);

      if (error) throw error;
    } else {
      const { error } = await supabase.from("reservations").insert({
        wishlist_id: item.wishlistId,
        item_id: item.id,
        user_id: actorUserId,
        status: "active",
        created_at: now,
        updated_at: now,
      });

      if (error) throw error;
    }
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code: string }).code) : "";
    if (code === "23505") {
      const winner = await findActiveReservationRowForItem(item.id);
      if (winner?.user_id === actorUserId) {
        return {
          reservationStatus: "active" as const,
          item: buildPublicItemReadModel(item, { availability: "reserved" }),
          idempotent: true,
        };
      }
      return { error: "ALREADY_RESERVED" as ReservationMutationError };
    }
    throw error;
  }

  const touchedItem = await touchItemUpdatedAt(item.id, now);
  if (touchedItem) {
    item = touchedItem;
  } else {
    item = { ...item, updatedAt: now };
  }

  const store = getStore();
  const cachedReservation = store.reservations.find(
    (reservation) => reservation.itemId === item.id && reservation.actorEmail === input.actorEmail,
  );
  if (cachedReservation) {
    cachedReservation.status = "active";
    cachedReservation.updatedAt = now;
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

  logAudit("reserve", item.id, input.actorEmail, item.wishlistId);

  return {
    reservationStatus: "active" as const,
    item: buildPublicItemReadModel(item, { availability: "reserved" }),
    idempotent: false,
  };
}

export async function unreservePublicItem(input: { wishlistId: string; itemId: string; actorEmail: string }) {
  const actorUserId = await resolveActorUserId(input.actorEmail);
  if (!actorUserId) {
    return { error: "ACTOR_NOT_FOUND" as ReservationMutationError };
  }

  const itemLookup = await findPublicItemForMutation({
    wishlistId: input.wishlistId,
    itemId: input.itemId,
  });
  if ("error" in itemLookup) {
    return { error: itemLookup.error as ReservationMutationError };
  }

  let item = itemLookup;
  const actorReservation = await findActiveReservationRowForActor({
    itemId: item.id,
    actorUserId,
  });
  if (!actorReservation) {
    return { error: "NO_ACTIVE_RESERVATION" as ReservationMutationError };
  }

  const releasedAt = nowIso();
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("reservations")
    .update({
      status: "released",
      updated_at: releasedAt,
    })
    .eq("id", actorReservation.id);

  if (error) throw error;

  const touchedItem = await touchItemUpdatedAt(item.id, releasedAt);
  if (touchedItem) {
    item = touchedItem;
  } else {
    item = { ...item, updatedAt: releasedAt };
  }

  const store = getStore();
  const cachedReservation = store.reservations.find(
    (reservation) => reservation.itemId === item.id && reservation.actorEmail === input.actorEmail,
  );
  if (cachedReservation) {
    cachedReservation.status = "released";
    cachedReservation.updatedAt = releasedAt;
  } else {
    store.reservations.unshift({
      id: randomUUID(),
      wishlistId: item.wishlistId,
      itemId: item.id,
      actorEmail: input.actorEmail,
      status: "released",
      createdAt: actorReservation.created_at,
      updatedAt: releasedAt,
    });
  }

  logAudit("unreserve", item.id, input.actorEmail, item.wishlistId);

  return {
    reservationStatus: "released" as const,
    item: buildPublicItemReadModel(item, { availability: "available" }),
  };
}

export async function contributeToPublicItem(input: {
  wishlistId: string;
  itemId: string;
  actorEmail: string;
  amountCents: number;
}) {
  const actorUserId = await resolveActorUserId(input.actorEmail);
  if (!actorUserId) {
    return { error: "ACTOR_NOT_FOUND" as ContributionMutationError };
  }

  const itemLookup = await findPublicItemForMutation({
    wishlistId: input.wishlistId,
    itemId: input.itemId,
  });
  if ("error" in itemLookup) {
    return { error: itemLookup.error as ContributionMutationError };
  }

  let item = itemLookup;

  if (item.archivedAt) {
    return { error: "ARCHIVED" as ContributionMutationError };
  }

  if (!item.isGroupFunded) {
    return { error: "NOT_GROUP_FUNDED" as ContributionMutationError };
  }

  if (!Number.isInteger(input.amountCents) || input.amountCents < 100) {
    return { error: "INVALID_AMOUNT" as ContributionMutationError };
  }

  const createdAt = nowIso();
  const supabase = getSupabaseAdminClient();
  const { data: inserted, error: insertError } = await supabase
    .from("contributions")
    .insert({
      item_id: item.id,
      user_id: actorUserId,
      amount_cents: input.amountCents,
      created_at: createdAt,
    })
    .select(contributionSelectColumns())
    .single();

  if (insertError || !inserted) {
    throw insertError || new Error("Unable to create contribution.");
  }

  const touched = await touchItemUpdatedAt(item.id, createdAt);
  if (touched) {
    item = touched;
  }

  const insertedRow = inserted as unknown as ContributionRow;
  const contributionRows = await listContributionRowsByItemIds([item.id]);
  const contributionStats = buildContributionStatsByItem(contributionRows).get(item.id) || {
    fundedCents: input.amountCents,
    contributorCount: 1,
  };

  const store = getStore();
  const contribution: ContributionRecord = {
    id: insertedRow.id || randomUUID(),
    wishlistId: item.wishlistId,
    itemId: item.id,
    actorEmail: input.actorEmail,
    amountCents: input.amountCents,
    createdAt: insertedRow.created_at || createdAt,
  };

  store.contributions.unshift(contribution);
  item.fundedCents = contributionStats.fundedCents;
  item.contributorCount = contributionStats.contributorCount;
  logAudit("contribute", item.id, input.actorEmail, item.wishlistId);

  return {
    contribution,
    item: buildPublicItemReadModel(item, {
      fundedCents: contributionStats.fundedCents,
      contributorCount: contributionStats.contributorCount,
    }),
  };
}

export async function recordWishlistOpen(input: { wishlistId: string; actorEmail: string }) {
  const actorUserId = await resolveActorUserId(input.actorEmail);
  if (!actorUserId) {
    return { error: "ACTOR_NOT_FOUND" as const };
  }

  const now = nowIso();
  const supabase = getSupabaseAdminClient();

  const { data: existing, error: existingError } = await supabase
    .from("wishlist_opens")
    .select(wishlistOpenSelectColumns())
    .eq("wishlist_id", input.wishlistId)
    .eq("user_id", actorUserId)
    .maybeSingle();

  if (existingError && existingError.code !== "PGRST116") {
    throw existingError;
  }

  if (!existing) {
    const { error: insertError } = await supabase.from("wishlist_opens").insert({
      wishlist_id: input.wishlistId,
      user_id: actorUserId,
      first_opened_at: now,
      last_opened_at: now,
      open_count: 1,
    });
    if (insertError) throw insertError;

    return {
      ok: true as const,
      openCount: 1,
      lastOpenedAt: now,
    };
  }

  const row = existing as unknown as WishlistOpenRow;
  const nextOpenCount = (Number.isFinite(row.open_count) ? row.open_count : 0) + 1;

  const { error: updateError } = await supabase
    .from("wishlist_opens")
    .update({
      last_opened_at: now,
      open_count: nextOpenCount,
    })
    .eq("id", row.id);

  if (updateError) throw updateError;

  return {
    ok: true as const,
    openCount: nextOpenCount,
    lastOpenedAt: now,
  };
}

async function listWishlistOpenRowsByActor(actorUserId: string): Promise<WishlistOpenRow[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("wishlist_opens")
    .select(wishlistOpenSelectColumns())
    .eq("user_id", actorUserId)
    .order("last_opened_at", { ascending: false });

  if (error) throw error;
  return (data || []) as unknown as WishlistOpenRow[];
}

export async function listActivityForActor(input: { actorEmail: string }): Promise<ActivityEntry[]> {
  const normalizedActorEmail = normalizeEmail(input.actorEmail);
  const actorUserId = await resolveActorUserId(normalizedActorEmail);
  if (!actorUserId) return [];

  const store = getStore();
  const itemTitleById = new Map(store.items.map((item) => [item.id, item.title]));

  const reservationEntries: ActivityEntry[] = store.reservations
    .filter((reservation) => normalizeEmail(reservation.actorEmail) === normalizedActorEmail)
    .map((reservation) => ({
      id: `res-${reservation.id}`,
      kind: "reservation",
      action: reservation.status === "active" ? "reserved" : "unreserved",
      wishlistId: reservation.wishlistId,
      itemId: reservation.itemId,
      itemTitle: itemTitleById.get(reservation.itemId) || "Untitled item",
      amountCents: null,
      status: reservation.status,
      openCount: null,
      happenedAt: reservation.updatedAt,
    }));

  const contributionEntries: ActivityEntry[] = store.contributions
    .filter((contribution) => normalizeEmail(contribution.actorEmail) === normalizedActorEmail)
    .map((contribution) => ({
      id: `con-${contribution.id}`,
      kind: "contribution",
      action: "contributed",
      wishlistId: contribution.wishlistId,
      itemId: contribution.itemId,
      itemTitle: itemTitleById.get(contribution.itemId) || "Untitled item",
      amountCents: contribution.amountCents,
      status: null,
      openCount: null,
      happenedAt: contribution.createdAt,
    }));
  const wishlistOpenRows = await listWishlistOpenRowsByActor(actorUserId);
  const wishlistVisitEntries: ActivityEntry[] = wishlistOpenRows.map((row) => ({
    id: `open-${row.id}`,
    kind: "visit",
    action: "opened_wishlist",
    wishlistId: row.wishlist_id,
    itemId: null,
    itemTitle: null,
    amountCents: null,
    status: null,
    openCount: row.open_count,
    happenedAt: row.last_opened_at,
  }));

  return [...wishlistVisitEntries, ...reservationEntries, ...contributionEntries].sort(
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

export async function prepareItemImageUpload(input: {
  itemId: string;
  ownerEmail: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  maxBytes: number;
  allowedMimeTypes: string[];
  ttlSeconds: number;
}) {
  const owned = await findOwnedItem({
    itemId: input.itemId,
    ownerEmail: input.ownerEmail,
  });
  if ("error" in owned) {
    return { error: owned.error as PrepareImageUploadError };
  }
  if (owned.archivedAt) {
    return { error: "ARCHIVED" as PrepareImageUploadError };
  }
  if (getItemImageUrls(owned).length >= ITEM_IMAGE_LIMIT) {
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
    wishlistId: owned.wishlistId,
    itemId: owned.id,
    filename: input.filename,
  });

  const uploadToken = randomUUID();
  const store = getStore();
  store.uploadTickets.push({
    token: uploadToken,
    itemId: owned.id,
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

  const owned = await findOwnedItem({
    itemId: ticket.itemId,
    ownerEmail: input.ownerEmail,
  });
  if ("error" in owned) {
    store.uploadTickets.splice(ticketIndex, 1);
    return { error: owned.error as UploadItemImageError };
  }
  if (owned.archivedAt) {
    store.uploadTickets.splice(ticketIndex, 1);
    return { error: "ARCHIVED" as UploadItemImageError };
  }
  if (getItemImageUrls(owned).length >= ITEM_IMAGE_LIMIT) {
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

  const previousImageUrls = getItemImageUrls(owned);
  const previousStoragePath = owned.imageUrl && isStorageRef(owned.imageUrl) ? parseStoragePath(owned.imageUrl) : null;
  const nextImageUrls = normalizeImageUrls([...previousImageUrls, `${STORAGE_PREFIX}${ticket.path}`]);

  const nextTimestamp = nowIso();
  const { data, error } = await supabase
    .from("items")
    .update({
      image_url: nextImageUrls[0] || null,
      image_urls: nextImageUrls,
      updated_at: nextTimestamp,
    })
    .eq("id", owned.id)
    .select(itemSelectColumns())
    .single();

  if (error || !data) {
    store.uploadTickets.splice(ticketIndex, 1);
    return { error: "NOT_FOUND" as UploadItemImageError };
  }

  const item = mapItemRowToRecord(data as unknown as ItemRow, input.ownerEmail);
  upsertCachedItem(item);
  logAudit("update", item.id, item.ownerEmail, item.wishlistId);

  store.uploadTickets.splice(ticketIndex, 1);

  return {
    item,
    storagePath: ticket.path,
    previousStoragePath,
  };
}

export async function createItemImagePreview(input: { itemId: string; ownerEmail: string; imageIndex?: number }) {
  const owned = await findOwnedItem({
    itemId: input.itemId,
    ownerEmail: input.ownerEmail,
  });
  if ("error" in owned) {
    return { error: owned.error as CreatePreviewError };
  }

  const imageRefs = getItemImageUrls(owned);
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

export async function deleteItemsForWishlist(input: { wishlistId: string; ownerEmail: string }) {
  const hasAccess = await hasOwnerAccessToWishlist(input.ownerEmail, input.wishlistId);
  if (!hasAccess) {
    return { deletedCount: 0 };
  }

  const rows = await listItemRowsByWishlist(input.wishlistId);
  const itemIds = new Set(rows.map((row) => row.id));

  if (itemIds.size === 0) {
    return { deletedCount: 0 };
  }

  const itemIdList = Array.from(itemIds);

  for (const row of rows) {
    const item = mapItemRowToRecord(row, input.ownerEmail);
    for (const imageRef of getItemImageUrls(item)) {
      if (isStorageRef(imageRef)) {
        removeImageByPath(parseStoragePath(imageRef));
      }
    }
  }

  const supabase = getSupabaseAdminClient();
  const { error: contributionDeleteError } = await supabase
    .from("contributions")
    .delete()
    .in("item_id", itemIdList);
  if (contributionDeleteError) throw contributionDeleteError;

  const { error: reservationDeleteError } = await supabase
    .from("reservations")
    .delete()
    .eq("wishlist_id", input.wishlistId);
  if (reservationDeleteError) throw reservationDeleteError;

  const { error } = await supabase.from("items").delete().eq("wishlist_id", input.wishlistId);
  if (error) throw error;

  removeCachedItems(itemIds);

  return { deletedCount: itemIds.size };
}
