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

declare global {
  // eslint-disable-next-line no-var
  var __itemStore:
    | {
        items: ItemRecord[];
        auditEvents: AuditEvent[];
      }
    | undefined;
}

function getStore() {
  if (!globalThis.__itemStore) {
    globalThis.__itemStore = {
      items: [],
      auditEvents: [],
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
  const now = new Date().toISOString();
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

  found.title = input.title;
  found.url = input.url;
  found.priceCents = input.priceCents;
  found.imageUrl = input.imageUrl;
  found.isGroupFunded = input.isGroupFunded;
  found.targetCents = input.targetCents;
  found.updatedAt = new Date().toISOString();

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
    found.archivedAt = new Date().toISOString();
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
