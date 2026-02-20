import { createHash, randomBytes, randomUUID } from "node:crypto";

import { getSupabaseAdminClient } from "@/app/_lib/supabase-admin";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WishlistRecord = {
  id: string;
  ownerEmail: string;
  title: string;
  occasionDate: string | null;
  occasionNote: string | null;
  currency: string;
  shareTokenHash: string;
  shareTokenHint: string;
  shareTokenDisabledAt: string | null;
  shareTokenRotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WishlistListItem = {
  id: string;
  title: string;
  occasionDate: string | null;
  occasionNote: string | null;
  currency: string;
  updatedAt: string;
  shareUrlPreview: string;
};

export type WishlistSort = "updated_desc" | "title_asc";

export type ShareLinkAuditAction = "rotate_share_link" | "disable_share_link" | "enable_share_link";

export type ShareLinkAuditEvent = {
  id: string;
  wishlistId: string;
  actorEmail: string;
  action: ShareLinkAuditAction;
  createdAt: string;
  after: {
    tokenHint: string;
    disabledAt: string | null;
  };
};

type RotationIdempotencyEntry = {
  key: string;
  expiresAt: number;
};

type WishlistRow = {
  id: string;
  owner_id: string;
  title: string;
  occasion_date: string | null;
  occasion_note: string | null;
  currency: string;
  share_token_hash: string;
  share_token_hint: string;
  share_token_disabled_at: string | null;
  share_token_rotated_at: string | null;
  created_at: string;
  updated_at: string;
};

type WishlistStoreState = {
  shareTokensByHash: Record<string, string>;
  shareLinkAuditEvents: ShareLinkAuditEvent[];
  rotationIdempotency: RotationIdempotencyEntry[];
  userIdByEmail: Record<string, string | null>;
  userEmailById: Record<string, string>;
};

declare global {
  // eslint-disable-next-line no-var
  var __wishlistStore: WishlistStoreState | undefined;
}

function getStore(): WishlistStoreState {
  if (!globalThis.__wishlistStore) {
    globalThis.__wishlistStore = {
      shareTokensByHash: {},
      shareLinkAuditEvents: [],
      rotationIdempotency: [],
      userIdByEmail: {},
      userEmailById: {},
    };
  }

  return globalThis.__wishlistStore;
}

function wishlistSelectColumns() {
  return [
    "id",
    "owner_id",
    "title",
    "occasion_date",
    "occasion_note",
    "currency",
    "share_token_hash",
    "share_token_hint",
    "share_token_disabled_at",
    "share_token_rotated_at",
    "created_at",
    "updated_at",
  ].join(",");
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeTokenBytes(value: number | undefined): number {
  if (!Number.isFinite(value ?? Number.NaN)) return 24;
  const rounded = Math.floor(value as number);
  if (rounded < 16) return 16;
  if (rounded > 64) return 64;
  return rounded;
}

function normalizeShareTokenPepper(raw: string | undefined): string {
  return raw?.trim() || "";
}

function createShareToken(tokenBytes?: number): string {
  const size = sanitizeTokenBytes(tokenBytes);
  return randomBytes(size).toString("base64url");
}

function hashShareToken(token: string, pepper: string): string {
  return createHash("sha256").update(`${pepper}:${token}`).digest("hex");
}

function parsePositiveInt(raw: string | undefined, fallback: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function createShareLinkAuditEvent(input: {
  wishlistId: string;
  actorEmail: string;
  action: ShareLinkAuditAction;
  tokenHint: string;
  disabledAt: string | null;
  createdAt?: string;
}) {
  const store = getStore();
  const createdAt = input.createdAt || nowIso();
  const event: ShareLinkAuditEvent = {
    id: randomUUID(),
    wishlistId: input.wishlistId,
    actorEmail: input.actorEmail,
    action: input.action,
    createdAt,
    after: {
      tokenHint: input.tokenHint,
      disabledAt: input.disabledAt,
    },
  };
  store.shareLinkAuditEvents.unshift(event);
  return event;
}

function pruneRotationIdempotency(now = Date.now()) {
  const store = getStore();
  store.rotationIdempotency = store.rotationIdempotency.filter((entry) => entry.expiresAt > now);
}

function rotationIdempotencyKey(input: { wishlistId: string; ownerEmail: string; idempotencyKey: string }) {
  return `${input.wishlistId}:${input.ownerEmail}:${input.idempotencyKey}`;
}

function normalizeEmail(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function mapWishlistRowToRecord(row: WishlistRow, ownerEmail?: string): WishlistRecord {
  const store = getStore();
  const normalizedOwnerEmail = normalizeEmail(ownerEmail) || store.userEmailById[row.owner_id] || "";

  if (normalizedOwnerEmail) {
    store.userEmailById[row.owner_id] = normalizedOwnerEmail;
    store.userIdByEmail[normalizedOwnerEmail] = row.owner_id;
  }

  return {
    id: row.id,
    ownerEmail: normalizedOwnerEmail,
    title: row.title,
    occasionDate: row.occasion_date,
    occasionNote: row.occasion_note,
    currency: row.currency,
    shareTokenHash: row.share_token_hash,
    shareTokenHint: row.share_token_hint,
    shareTokenDisabledAt: row.share_token_disabled_at ?? null,
    shareTokenRotatedAt: row.share_token_rotated_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function resolveOwnerUserId(ownerEmail: string): Promise<string | null> {
  const normalizedEmail = normalizeEmail(ownerEmail);
  if (!EMAIL_REGEX.test(normalizedEmail)) return null;

  const store = getStore();
  if (Object.prototype.hasOwnProperty.call(store.userIdByEmail, normalizedEmail)) {
    return store.userIdByEmail[normalizedEmail];
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
      store.userIdByEmail[normalizedEmail] = found.id;
      store.userEmailById[found.id] = normalizedEmail;
      return found.id;
    }

    if (!data?.nextPage || users.length === 0) break;
    page = data.nextPage;
  }

  store.userIdByEmail[normalizedEmail] = null;
  return null;
}

async function fetchOwnerEmailByUserId(ownerId: string): Promise<string | null> {
  const store = getStore();
  if (store.userEmailById[ownerId]) return store.userEmailById[ownerId];

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.auth.admin.getUserById(ownerId);
  if (error || !data?.user?.email) return null;

  const normalizedEmail = normalizeEmail(data.user.email);
  if (!normalizedEmail) return null;

  store.userEmailById[ownerId] = normalizedEmail;
  store.userIdByEmail[normalizedEmail] = ownerId;
  return normalizedEmail;
}

async function findWishlistById(wishlistId: string): Promise<WishlistRow | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("wishlists")
    .select(wishlistSelectColumns())
    .eq("id", wishlistId)
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  if (!data) return null;
  return data as unknown as WishlistRow;
}

async function findWishlistByTokenHash(tokenHash: string): Promise<WishlistRow | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("wishlists")
    .select(wishlistSelectColumns())
    .eq("share_token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  if (!data) return null;
  return data as unknown as WishlistRow;
}

async function findWishlistByTokenHint(tokenHint: string): Promise<WishlistRow | null> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("wishlists")
    .select(wishlistSelectColumns())
    .eq("share_token_hint", tokenHint)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  if (!data) return null;
  return data as unknown as WishlistRow;
}

export function normalizeCanonicalHost(raw: string | undefined): string {
  const host = raw?.trim() || "https://design.rhcargo.ru";
  return host.replace(/\/$/, "");
}

export function buildPublicShareUrl(host: string, tokenOrHint: string): string {
  return `${host}/l/${tokenOrHint}`;
}

export async function createWishlistRecord(input: {
  ownerEmail: string;
  ownerId?: string;
  title: string;
  occasionDate: string | null;
  occasionNote: string | null;
  currency: string;
  canonicalHost?: string;
  shareTokenBytes?: number;
  shareTokenPepper?: string;
}) {
  const ownerEmail = normalizeEmail(input.ownerEmail);
  const ownerId = input.ownerId?.trim() || (await resolveOwnerUserId(ownerEmail));
  if (!ownerId) {
    throw new Error("OWNER_NOT_FOUND");
  }

  const canonicalHost = normalizeCanonicalHost(input.canonicalHost);
  const pepper = normalizeShareTokenPepper(input.shareTokenPepper ?? process.env.SHARE_TOKEN_PEPPER);
  const token = createShareToken(input.shareTokenBytes ?? parsePositiveInt(process.env.SHARE_TOKEN_BYTES, 24));
  const tokenHash = hashShareToken(token, pepper);
  const tokenHint = token.slice(0, 8);

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("wishlists")
    .insert({
      owner_id: ownerId,
      title: input.title,
      occasion_date: input.occasionDate,
      occasion_note: input.occasionNote,
      currency: input.currency,
      share_token_hash: tokenHash,
      share_token_hint: tokenHint,
      share_token_disabled_at: null,
      share_token_rotated_at: null,
    })
    .select(wishlistSelectColumns())
    .single();

  if (error || !data) {
    throw error || new Error("Unable to create wishlist.");
  }

  const store = getStore();
  store.shareTokensByHash[tokenHash] = token;

  const record = mapWishlistRowToRecord(data as unknown as WishlistRow, ownerEmail);

  return {
    record,
    shareUrl: buildPublicShareUrl(canonicalHost, token),
    shareUrlPreview: buildPublicShareUrl(canonicalHost, token),
  };
}

export async function listWishlistRecords(input: {
  ownerEmail: string;
  ownerId?: string;
  search: string;
  sort: WishlistSort;
  canonicalHost?: string;
}): Promise<WishlistListItem[]> {
  const ownerEmail = normalizeEmail(input.ownerEmail);
  const ownerId = input.ownerId?.trim() || (await resolveOwnerUserId(ownerEmail));
  if (!ownerId) return [];

  const canonicalHost = normalizeCanonicalHost(input.canonicalHost);
  const needle = input.search.trim();

  const supabase = getSupabaseAdminClient();
  let query = supabase.from("wishlists").select(wishlistSelectColumns()).eq("owner_id", ownerId);

  if (needle) {
    query = query.ilike("title", `%${needle}%`);
  }

  if (input.sort === "title_asc") {
    query = query.order("title", { ascending: true }).order("updated_at", { ascending: false });
  } else {
    query = query.order("updated_at", { ascending: false });
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const rows = (data || []) as unknown as WishlistRow[];
  const store = getStore();

  return rows.map((row) => ({
    shareUrlPreview: buildPublicShareUrl(canonicalHost, store.shareTokensByHash[row.share_token_hash] || row.share_token_hint),
    id: row.id,
    title: row.title,
    occasionDate: row.occasion_date,
    occasionNote: row.occasion_note,
    currency: row.currency,
    updatedAt: row.updated_at,
  }));
}

export type ResolvePublicWishlistError = "NOT_FOUND" | "DISABLED";

export async function resolvePublicWishlistByToken(
  token: string,
  options?: {
    shareTokenPepper?: string;
  },
): Promise<{ wishlist: WishlistRecord } | { error: ResolvePublicWishlistError }> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return { error: "NOT_FOUND" as ResolvePublicWishlistError };
  }

  const pepper = normalizeShareTokenPepper(options?.shareTokenPepper ?? process.env.SHARE_TOKEN_PEPPER);

  const primaryHash = hashShareToken(normalizedToken, pepper);
  let row = await findWishlistByTokenHash(primaryHash);

  if (!row && pepper) {
    // Legacy fallback for tokens created before SHARE_TOKEN_PEPPER was introduced.
    const legacyHash = hashShareToken(normalizedToken, "");
    row = await findWishlistByTokenHash(legacyHash);
  }

  if (!row) {
    row = await findWishlistByTokenHint(normalizedToken);
  }

  if (!row) {
    return { error: "NOT_FOUND" as ResolvePublicWishlistError };
  }

  if (row.share_token_disabled_at) {
    return { error: "DISABLED" as ResolvePublicWishlistError };
  }

  return { wishlist: mapWishlistRowToRecord(row) };
}

export async function getWishlistRecordById(wishlistId: string): Promise<WishlistRecord | null> {
  const row = await findWishlistById(wishlistId);
  if (!row) return null;

  const ownerEmail = await fetchOwnerEmailByUserId(row.owner_id);
  return mapWishlistRowToRecord(row, ownerEmail || undefined);
}

export async function getPublicShareTokenForWishlist(wishlistId: string): Promise<string | null> {
  const row = await findWishlistById(wishlistId);
  if (!row) return null;
  const store = getStore();
  return store.shareTokensByHash[row.share_token_hash] || row.share_token_hint;
}

export type RotateShareLinkError = "NOT_FOUND" | "FORBIDDEN";

export async function rotateWishlistShareLink(input: {
  wishlistId: string;
  ownerEmail: string;
  ownerId?: string;
  canonicalHost?: string;
  shareTokenBytes?: number;
  shareTokenPepper?: string;
  idempotencyKey?: string;
  idempotencyTtlSec?: number;
}) {
  const ownerEmail = normalizeEmail(input.ownerEmail);
  const ownerId = input.ownerId?.trim() || (await resolveOwnerUserId(ownerEmail));
  if (!ownerId) {
    return { error: "FORBIDDEN" as RotateShareLinkError };
  }

  const store = getStore();
  const found = await findWishlistById(input.wishlistId);

  if (!found) {
    return { error: "NOT_FOUND" as RotateShareLinkError };
  }

  if (found.owner_id !== ownerId) {
    return { error: "FORBIDDEN" as RotateShareLinkError };
  }

  const canonicalHost = normalizeCanonicalHost(input.canonicalHost);
  const pepper = normalizeShareTokenPepper(input.shareTokenPepper ?? process.env.SHARE_TOKEN_PEPPER);

  const safeIdempotencyKey = (input.idempotencyKey || "").trim();
  if (safeIdempotencyKey) {
    pruneRotationIdempotency();

    const key = rotationIdempotencyKey({
      wishlistId: input.wishlistId,
      ownerEmail,
      idempotencyKey: safeIdempotencyKey,
    });

    const replay = store.rotationIdempotency.some((entry) => entry.key === key);
    if (replay) {
      return {
        ok: true as const,
        alreadyProcessed: true as const,
        rotatedAt: found.share_token_rotated_at,
      };
    }

    const ttlSec = parsePositiveInt(input.idempotencyTtlSec?.toString(), 180);
    store.rotationIdempotency.push({
      key,
      expiresAt: Date.now() + ttlSec * 1000,
    });
  }

  const previousHash = found.share_token_hash;

  const token = createShareToken(input.shareTokenBytes ?? parsePositiveInt(process.env.SHARE_TOKEN_BYTES, 24));
  const tokenHash = hashShareToken(token, pepper);
  const tokenHint = token.slice(0, 8);
  const timestamp = nowIso();

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("wishlists")
    .update({
      share_token_hash: tokenHash,
      share_token_hint: tokenHint,
      share_token_rotated_at: timestamp,
      updated_at: timestamp,
    })
    .eq("id", found.id)
    .eq("owner_id", ownerId)
    .select(wishlistSelectColumns())
    .single();

  if (error || !data) {
    throw error || new Error("Unable to rotate share link.");
  }

  delete store.shareTokensByHash[previousHash];
  store.shareTokensByHash[tokenHash] = token;

  const updatedRecord = mapWishlistRowToRecord(data as unknown as WishlistRow, ownerEmail);

  const auditEvent = createShareLinkAuditEvent({
    wishlistId: updatedRecord.id,
    actorEmail: ownerEmail,
    action: "rotate_share_link",
    tokenHint: updatedRecord.shareTokenHint,
    disabledAt: updatedRecord.shareTokenDisabledAt,
    createdAt: timestamp,
  });

  return {
    ok: true as const,
    alreadyProcessed: false as const,
    rotatedAt: timestamp,
    shareUrl: buildPublicShareUrl(canonicalHost, token),
    shareUrlPreview: buildPublicShareUrl(canonicalHost, token),
    auditEventId: auditEvent.id,
  };
}

export type UpdateShareLinkDisabledError = "NOT_FOUND";

export async function updateWishlistShareLinkDisabled(input: {
  wishlistId: string;
  actorEmail: string;
  disabled: boolean;
}) {
  const found = await findWishlistById(input.wishlistId);
  if (!found) {
    return { error: "NOT_FOUND" as UpdateShareLinkDisabledError };
  }

  const wasDisabled = Boolean(found.share_token_disabled_at);
  const alreadyApplied = input.disabled ? wasDisabled : !wasDisabled;

  const ownerEmail = await fetchOwnerEmailByUserId(found.owner_id);
  const ownerRecord = mapWishlistRowToRecord(found, ownerEmail || undefined);

  if (alreadyApplied) {
    return {
      ok: true as const,
      alreadyApplied: true as const,
      wishlist: ownerRecord,
      auditEventId: null as string | null,
    };
  }

  const timestamp = nowIso();
  const disabledAt = input.disabled ? timestamp : null;

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("wishlists")
    .update({
      share_token_disabled_at: disabledAt,
      updated_at: timestamp,
    })
    .eq("id", found.id)
    .select(wishlistSelectColumns())
    .single();

  if (error || !data) {
    throw error || new Error("Unable to update share link status.");
  }

  const updated = mapWishlistRowToRecord(data as unknown as WishlistRow, ownerEmail || undefined);

  const auditEvent = createShareLinkAuditEvent({
    wishlistId: updated.id,
    actorEmail: normalizeEmail(input.actorEmail),
    action: input.disabled ? "disable_share_link" : "enable_share_link",
    tokenHint: updated.shareTokenHint,
    disabledAt: updated.shareTokenDisabledAt,
    createdAt: timestamp,
  });

  return {
    ok: true as const,
    alreadyApplied: false as const,
    wishlist: updated,
    auditEventId: auditEvent.id,
  };
}

export function listShareLinkAuditEvents(input: {
  wishlistId?: string;
  action?: ShareLinkAuditAction;
  since?: string;
  limit?: number;
}) {
  const store = getStore();
  const sinceTime = input.since ? new Date(input.since).getTime() : Number.NEGATIVE_INFINITY;
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);

  return store.shareLinkAuditEvents
    .filter((event) => {
      if (input.wishlistId && event.wishlistId !== input.wishlistId) return false;
      if (input.action && event.action !== input.action) return false;
      if (new Date(event.createdAt).getTime() < sinceTime) return false;
      return true;
    })
    .slice(0, limit);
}

export function pruneShareLinkAuditEvents(input: { retentionDays: number }) {
  const safeRetentionDays = Math.min(Math.max(Math.floor(input.retentionDays), 1), 3650);
  const cutoffMs = Date.now() - safeRetentionDays * 24 * 60 * 60 * 1000;
  const store = getStore();
  const before = store.shareLinkAuditEvents.length;
  store.shareLinkAuditEvents = store.shareLinkAuditEvents.filter(
    (event) => new Date(event.createdAt).getTime() >= cutoffMs,
  );
  return {
    removedCount: before - store.shareLinkAuditEvents.length,
    retentionDays: safeRetentionDays,
  };
}

export type DeleteWishlistError = "NOT_FOUND" | "FORBIDDEN";

export async function deleteWishlistRecord(input: { wishlistId: string; ownerEmail: string; ownerId?: string }) {
  const ownerEmail = normalizeEmail(input.ownerEmail);
  const ownerId = input.ownerId?.trim() || (await resolveOwnerUserId(ownerEmail));
  if (!ownerId) {
    return { error: "FORBIDDEN" as DeleteWishlistError };
  }

  const found = await findWishlistById(input.wishlistId);
  if (!found) {
    return { error: "NOT_FOUND" as DeleteWishlistError };
  }

  if (found.owner_id !== ownerId) {
    return { error: "FORBIDDEN" as DeleteWishlistError };
  }

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("wishlists").delete().eq("id", found.id).eq("owner_id", ownerId);
  if (error) {
    throw error;
  }

  const store = getStore();
  delete store.shareTokensByHash[found.share_token_hash];
  store.shareLinkAuditEvents = store.shareLinkAuditEvents.filter((event) => event.wishlistId !== found.id);
  store.rotationIdempotency = store.rotationIdempotency.filter((entry) => !entry.key.startsWith(`${found.id}:`));

  return {
    ok: true as const,
    wishlistId: found.id,
  };
}
