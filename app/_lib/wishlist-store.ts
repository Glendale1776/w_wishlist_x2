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
  var __wishlistStore: { wishlists: WishlistRecord[] } | undefined;
}

function getStore() {
  if (!globalThis.__wishlistStore) {
    globalThis.__wishlistStore = { wishlists: [] };
  }
  return globalThis.__wishlistStore;
}

function normalizeCanonicalHost(raw: string | undefined): string {
  const host = raw?.trim() || "https://design.rhcargo.ru";
  return host.replace(/\/$/, "");
}

function createShareToken(): string {
  return randomBytes(24).toString("base64url");
}

function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function buildShareUrl(host: string, tokenOrHint: string): string {
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
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const store = getStore();
  store.wishlists.unshift(record);

  return {
    record,
    shareUrl: buildShareUrl(canonicalHost, token),
    shareUrlPreview: buildShareUrl(canonicalHost, tokenHint),
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
    id: item.id,
    title: item.title,
    occasionDate: item.occasionDate,
    occasionNote: item.occasionNote,
    currency: item.currency,
    updatedAt: item.updatedAt,
    shareUrlPreview: buildShareUrl(canonicalHost, item.shareTokenHint),
  }));
}
