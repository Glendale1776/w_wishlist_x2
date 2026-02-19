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

declare global {
  // eslint-disable-next-line no-var
  var __wishlistStore:
    | {
        wishlists: WishlistRecord[];
        shareTokensByHash: Record<string, string>;
      }
    | undefined;
}

function getStore() {
  if (!globalThis.__wishlistStore) {
    globalThis.__wishlistStore = {
      wishlists: [],
      shareTokensByHash: {},
    };
  }

  if (!globalThis.__wishlistStore.shareTokensByHash) {
    globalThis.__wishlistStore.shareTokensByHash = {};
  }

  return globalThis.__wishlistStore;
}

export function normalizeCanonicalHost(raw: string | undefined): string {
  const host = raw?.trim() || "https://design.rhcargo.ru";
  return host.replace(/\/$/, "");
}

function createShareToken(): string {
  return randomBytes(24).toString("base64url");
}

function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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
}) {
  const canonicalHost = normalizeCanonicalHost(input.canonicalHost);
  const token = createShareToken();
  const tokenHash = hashShareToken(token);
  const tokenHint = token.slice(0, 8);
  const timestamp = new Date().toISOString();

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
    // Use mapped full token when available. Falls back to hint only for legacy in-memory rows.
    // This keeps share links functional while preserving hash-based lookup for validation.
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
): { wishlist: WishlistRecord } | { error: ResolvePublicWishlistError } {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return { error: "NOT_FOUND" as ResolvePublicWishlistError };
  }

  const tokenHash = hashShareToken(normalizedToken);
  const store = getStore();

  let record = store.wishlists.find((wishlist) => wishlist.shareTokenHash === tokenHash);

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
