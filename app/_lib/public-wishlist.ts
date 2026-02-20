import { createHash } from "node:crypto";

import { listPublicItemsForWishlist } from "@/app/_lib/item-store";
import {
  buildPublicShareUrl,
  normalizeCanonicalHost,
  resolvePublicWishlistByToken,
} from "@/app/_lib/wishlist-store";

export type PublicWishlistItem = {
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
};

export type PublicWishlistReadModel = {
  version: string;
  wishlist: {
    id: string;
    title: string;
    occasionDate: string | null;
    occasionNote: string | null;
    currency: string;
    shareUrl: string;
    itemCount: number;
  };
  items: PublicWishlistItem[];
};

export type PublicWishlistResolveResult =
  | {
      ok: true;
      model: PublicWishlistReadModel;
    }
  | {
      ok: false;
      error: "NOT_FOUND" | "DISABLED";
    };

function buildVersion(wishlistUpdatedAt: string, itemVersions: Array<{ id: string; updatedAt: string }>) {
  const source = JSON.stringify({
    wishlistUpdatedAt,
    itemVersions: itemVersions.map((item) => `${item.id}:${item.updatedAt}`),
  });
  return createHash("sha1").update(source).digest("hex").slice(0, 12);
}

export async function resolvePublicWishlistReadModel(input: {
  shareToken: string;
  canonicalHost?: string;
}): Promise<PublicWishlistResolveResult> {
  const resolved = await resolvePublicWishlistByToken(input.shareToken);

  if ("error" in resolved) {
    return {
      ok: false,
      error: resolved.error,
    };
  }

  const canonicalHost = normalizeCanonicalHost(input.canonicalHost);
  const wishlist = resolved.wishlist;
  const rawItems = listPublicItemsForWishlist({ wishlistId: wishlist.id });
  const version = buildVersion(
    wishlist.updatedAt,
    rawItems.map((item) => ({ id: item.id, updatedAt: item.updatedAt })),
  );

  return {
    ok: true,
    model: {
      version,
      wishlist: {
        id: wishlist.id,
        title: wishlist.title,
        occasionDate: wishlist.occasionDate,
        occasionNote: wishlist.occasionNote,
        currency: wishlist.currency,
        shareUrl: buildPublicShareUrl(canonicalHost, input.shareToken),
        itemCount: rawItems.length,
      },
      items: rawItems.map(({ updatedAt: _ignoredUpdatedAt, ...item }) => item),
    },
  };
}
