"use client";

export type WishlistSort = "updated_desc" | "title_asc";

export type WishlistPreview = {
  id: string;
  title: string;
  occasionDate: string | null;
  occasionNote: string | null;
  currency: string;
  updatedAt: string;
  shareUrlPreview: string;
};

export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export type ApiErrorResponse = {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
    fieldErrors?: Record<string, string>;
  };
};

export type WishlistListResponse = {
  ok: true;
  wishlists: WishlistPreview[];
};

export type WishlistCreatePayload = {
  title: string;
  occasionDate: string | null;
  occasionNote: string | null;
  currency?: string;
};

export type WishlistCreateResponse = {
  ok: true;
  wishlist: WishlistPreview & {
    shareUrl: string;
  };
};

export function parseWishlistSort(value: string | null): WishlistSort {
  return value === "title_asc" ? "title_asc" : "updated_desc";
}

export function createWishlistsQuery(search: string, sort: WishlistSort): string {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  if (sort !== "updated_desc") params.set("sort", sort);
  return params.toString();
}
