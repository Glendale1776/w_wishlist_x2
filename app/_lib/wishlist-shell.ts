"use client";

export type WishlistSort = "updated_desc" | "title_asc";
export type WishlistViewState = "populated" | "empty";

export type WishlistPreview = {
  id: string;
  title: string;
  occasionDate: string | null;
  updatedAt: string;
  shareToken: string;
};

export const MOCK_WISHLISTS: WishlistPreview[] = [
  {
    id: "wl_001",
    title: "Birthday 2026",
    occasionDate: "2026-08-14",
    updatedAt: "2026-02-18T14:10:00Z",
    shareToken: "token-birthday-2026",
  },
  {
    id: "wl_002",
    title: "Holiday Gathering",
    occasionDate: "2026-12-24",
    updatedAt: "2026-02-16T09:20:00Z",
    shareToken: "token-holiday-2026",
  },
  {
    id: "wl_003",
    title: "Baby Shower",
    occasionDate: "2026-05-09",
    updatedAt: "2026-02-12T18:35:00Z",
    shareToken: "token-shower-2026",
  },
];

export function parseWishlistSort(value: string | null): WishlistSort {
  return value === "title_asc" ? "title_asc" : "updated_desc";
}

export function parseWishlistViewState(value: string | null): WishlistViewState {
  return value === "empty" ? "empty" : "populated";
}

export function filterAndSortWishlists(
  list: WishlistPreview[],
  search: string,
  sort: WishlistSort,
): WishlistPreview[] {
  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? list.filter((item) => item.title.toLowerCase().includes(needle))
    : [...list];

  if (sort === "title_asc") {
    return filtered.sort((a, b) => a.title.localeCompare(b.title));
  }

  return filtered.sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function buildShareUrl(shareToken: string): string {
  const canonical = process.env.NEXT_PUBLIC_CANONICAL_HOST || "https://design.rhcargo.ru";
  return `${canonical.replace(/\/$/, "")}/l/${shareToken}`;
}
