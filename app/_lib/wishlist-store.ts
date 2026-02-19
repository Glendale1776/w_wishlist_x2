import { createHash, randomBytes, randomUUID } from "node:crypto";

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

type ShareLinkAuditEvent = {
  id: string;
  wishlistId: string;
  actorEmail: string;
  action: "rotate_share_link";
  createdAt: string;
  after: {
    tokenHint: string;
  };
};

type RotationIdempotencyEntry = {
  key: string;
  expiresAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __wishlistStore:
    | {
        wishlists: WishlistRecord[];
        shareTokensByHash: Record<string, string>;
        shareLinkAuditEvents: ShareLinkAuditEvent[];
        rotationIdempotency: RotationIdempotencyEntry[];
      }
    | undefined;
}

function getStore() {
  if (!globalThis.__wishlistStore) {
    globalThis.__wishlistStore = {
      wishlists: [],
      shareTokensByHash: {},
      shareLinkAuditEvents: [],
      rotationIdempotency: [],
    };
  }

  if (!globalThis.__wishlistStore.shareTokensByHash) {
    globalThis.__wishlistStore.shareTokensByHash = {};
  }

  if (!globalThis.__wishlistStore.shareLinkAuditEvents) {
    globalThis.__wishlistStore.shareLinkAuditEvents = [];
  }

  if (!globalThis.__wishlistStore.rotationIdempotency) {
    globalThis.__wishlistStore.rotationIdempotency = [];
  }

  return globalThis.__wishlistStore;
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

function pruneRotationIdempotency(now = Date.now()) {
  const store = getStore();
  store.rotationIdempotency = store.rotationIdempotency.filter((entry) => entry.expiresAt > now);
}

function rotationIdempotencyKey(input: { wishlistId: string; ownerEmail: string; idempotencyKey: string }) {
  return `${input.wishlistId}:${input.ownerEmail}:${input.idempotencyKey}`;
}

export function normalizeCanonicalHost(raw: string | undefined): string {
  const host = raw?.trim() || "https://design.rhcargo.ru";
  return host.replace(/\/$/, "");
}

export function buildPublicShareUrl(host: string, tokenOrHint: string): string {
  return `${host}/l/${tokenOrHint}`;
}

export function createWishlistRecord(input: {
  ownerEmail: string;
  title: string;
  occasionDate: string | null;
  occasionNote: string | null;
  currency: string;
  canonicalHost?: string;
  shareTokenBytes?: number;
  shareTokenPepper?: string;
}) {
  const canonicalHost = normalizeCanonicalHost(input.canonicalHost);
  const pepper = normalizeShareTokenPepper(input.shareTokenPepper ?? process.env.SHARE_TOKEN_PEPPER);
  const token = createShareToken(input.shareTokenBytes ?? parsePositiveInt(process.env.SHARE_TOKEN_BYTES, 24));
  const tokenHash = hashShareToken(token, pepper);
  const tokenHint = token.slice(0, 8);
  const timestamp = nowIso();

  const record: WishlistRecord = {
    id: randomUUID(),
    ownerEmail: input.ownerEmail,
    title: input.title,
    occasionDate: input.occasionDate,
    occasionNote: input.occasionNote,
    currency: input.currency,
    shareTokenHash: tokenHash,
    shareTokenHint: tokenHint,
    shareTokenDisabledAt: null,
    shareTokenRotatedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const store = getStore();
  store.wishlists.unshift(record);
  store.shareTokensByHash[tokenHash] = token;

  return {
    record,
    shareUrl: buildPublicShareUrl(canonicalHost, token),
    shareUrlPreview: buildPublicShareUrl(canonicalHost, token),
  };
}

export function listWishlistRecords(input: {
  ownerEmail: string;
  search: string;
  sort: WishlistSort;
  canonicalHost?: string;
}): WishlistListItem[] {
  const canonicalHost = normalizeCanonicalHost(input.canonicalHost);
  const needle = input.search.trim().toLowerCase();
  const store = getStore();

  const filtered = store.wishlists.filter((item) => {
    if (item.ownerEmail !== input.ownerEmail) return false;
    if (!needle) return true;
    return item.title.toLowerCase().includes(needle);
  });

  if (input.sort === "title_asc") {
    filtered.sort((a, b) => a.title.localeCompare(b.title));
  } else {
    filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  return filtered.map((item) => ({
    shareUrlPreview: buildPublicShareUrl(
      canonicalHost,
      store.shareTokensByHash[item.shareTokenHash] || item.shareTokenHint,
    ),
    id: item.id,
    title: item.title,
    occasionDate: item.occasionDate,
    occasionNote: item.occasionNote,
    currency: item.currency,
    updatedAt: item.updatedAt,
  }));
}

export type ResolvePublicWishlistError = "NOT_FOUND" | "DISABLED";

export function resolvePublicWishlistByToken(
  token: string,
  options?: {
    shareTokenPepper?: string;
  },
): { wishlist: WishlistRecord } | { error: ResolvePublicWishlistError } {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return { error: "NOT_FOUND" as ResolvePublicWishlistError };
  }

  const store = getStore();
  const pepper = normalizeShareTokenPepper(options?.shareTokenPepper ?? process.env.SHARE_TOKEN_PEPPER);

  const primaryHash = hashShareToken(normalizedToken, pepper);
  let record = store.wishlists.find((wishlist) => wishlist.shareTokenHash === primaryHash);

  if (!record && pepper) {
    // Legacy fallback for tokens created before SHARE_TOKEN_PEPPER was introduced.
    const legacyHash = hashShareToken(normalizedToken, "");
    record = store.wishlists.find((wishlist) => wishlist.shareTokenHash === legacyHash);
  }

  if (!record) {
    record = store.wishlists.find((wishlist) => wishlist.shareTokenHint === normalizedToken);
  }

  if (!record) {
    return { error: "NOT_FOUND" as ResolvePublicWishlistError };
  }

  if (record.shareTokenDisabledAt) {
    return { error: "DISABLED" as ResolvePublicWishlistError };
  }

  return { wishlist: record };
}

export function getWishlistRecordById(wishlistId: string): WishlistRecord | null {
  const store = getStore();
  const found = store.wishlists.find((wishlist) => wishlist.id === wishlistId);
  return found || null;
}

export function getPublicShareTokenForWishlist(wishlistId: string): string | null {
  const store = getStore();
  const found = store.wishlists.find((wishlist) => wishlist.id === wishlistId);
  if (!found) return null;
  return store.shareTokensByHash[found.shareTokenHash] || found.shareTokenHint;
}

export type RotateShareLinkError = "NOT_FOUND" | "FORBIDDEN";

export function rotateWishlistShareLink(input: {
  wishlistId: string;
  ownerEmail: string;
  canonicalHost?: string;
  shareTokenBytes?: number;
  shareTokenPepper?: string;
  idempotencyKey?: string;
  idempotencyTtlSec?: number;
}) {
  const store = getStore();
  const found = store.wishlists.find((wishlist) => wishlist.id === input.wishlistId);

  if (!found) {
    return { error: "NOT_FOUND" as RotateShareLinkError };
  }

  if (found.ownerEmail !== input.ownerEmail) {
    return { error: "FORBIDDEN" as RotateShareLinkError };
  }

  const canonicalHost = normalizeCanonicalHost(input.canonicalHost);
  const pepper = normalizeShareTokenPepper(input.shareTokenPepper ?? process.env.SHARE_TOKEN_PEPPER);

  const safeIdempotencyKey = (input.idempotencyKey || "").trim();
  if (safeIdempotencyKey) {
    pruneRotationIdempotency();

    const key = rotationIdempotencyKey({
      wishlistId: input.wishlistId,
      ownerEmail: input.ownerEmail,
      idempotencyKey: safeIdempotencyKey,
    });

    const replay = store.rotationIdempotency.some((entry) => entry.key === key);
    if (replay) {
      return {
        ok: true as const,
        alreadyProcessed: true as const,
        rotatedAt: found.shareTokenRotatedAt,
      };
    }

    const ttlSec = parsePositiveInt(input.idempotencyTtlSec?.toString(), 180);
    store.rotationIdempotency.push({
      key,
      expiresAt: Date.now() + ttlSec * 1000,
    });
  }

  const previousHash = found.shareTokenHash;

  const token = createShareToken(input.shareTokenBytes ?? parsePositiveInt(process.env.SHARE_TOKEN_BYTES, 24));
  const tokenHash = hashShareToken(token, pepper);
  const tokenHint = token.slice(0, 8);
  const timestamp = nowIso();

  found.shareTokenHash = tokenHash;
  found.shareTokenHint = tokenHint;
  found.shareTokenRotatedAt = timestamp;
  found.updatedAt = timestamp;

  delete store.shareTokensByHash[previousHash];
  store.shareTokensByHash[tokenHash] = token;

  const auditEvent: ShareLinkAuditEvent = {
    id: randomUUID(),
    wishlistId: found.id,
    actorEmail: input.ownerEmail,
    action: "rotate_share_link",
    createdAt: timestamp,
    after: {
      tokenHint,
    },
  };
  store.shareLinkAuditEvents.unshift(auditEvent);

  return {
    ok: true as const,
    alreadyProcessed: false as const,
    rotatedAt: timestamp,
    shareUrl: buildPublicShareUrl(canonicalHost, token),
    shareUrlPreview: buildPublicShareUrl(canonicalHost, token),
    auditEventId: auditEvent.id,
  };
}

export function listShareLinkAuditEvents(input: { wishlistId?: string }) {
  const store = getStore();

  return store.shareLinkAuditEvents.filter((event) => {
    if (!input.wishlistId) return true;
    return event.wishlistId === input.wishlistId;
  });
}
