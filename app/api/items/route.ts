import { NextRequest, NextResponse } from "next/server";

import { createItem, listItemsForWishlist } from "@/app/_lib/item-store";
import { listWishlistRecords } from "@/app/_lib/wishlist-store";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_REGEX = /^https?:\/\//i;
const STORAGE_URL_REGEX = /^storage:\/\//i;
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 600;
const IMAGE_LIMIT = 10;

type ApiErrorCode = "AUTH_REQUIRED" | "VALIDATION_ERROR" | "FORBIDDEN" | "NOT_FOUND" | "INTERNAL_ERROR";

type ItemPayload = {
  wishlistId?: string;
  title?: string;
  description?: string | null;
  url?: string | null;
  priceCents?: number | null;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  isGroupFunded?: boolean;
  targetCents?: number | null;
};

function errorResponse(status: number, code: ApiErrorCode, message: string, fieldErrors?: Record<string, string>) {
  return NextResponse.json(
    {
      ok: false as const,
      error: { code, message, fieldErrors },
    },
    { status },
  );
}

function ownerEmailFromHeader(request: NextRequest) {
  const value = request.headers.get("x-owner-email")?.trim().toLowerCase() || "";
  if (!EMAIL_REGEX.test(value)) return null;
  return value;
}

function validatePayload(body: ItemPayload) {
  const fieldErrors: Record<string, string> = {};
  const title = (body.title || "").trim();
  const description = body.description?.trim() || null;
  const wishlistId = (body.wishlistId || "").trim();
  const url = body.url?.trim() || null;
  const imageUrl = body.imageUrl?.trim() || null;
  const imageUrls = Array.isArray(body.imageUrls)
    ? body.imageUrls.map((value) => (value || "").trim()).filter(Boolean)
    : [];
  const priceCents = body.priceCents ?? null;
  const isGroupFunded = Boolean(body.isGroupFunded);
  const targetCents = body.targetCents ?? null;

  if (!wishlistId) fieldErrors.wishlistId = "Wishlist ID is required.";

  if (!title) fieldErrors.title = "Item title is required.";
  if (title.length > TITLE_MAX) fieldErrors.title = `Item title must be ${TITLE_MAX} chars or less.`;
  if (description && description.length > DESCRIPTION_MAX) {
    fieldErrors.description = `Description must be ${DESCRIPTION_MAX} chars or less.`;
  }

  if (url && !URL_REGEX.test(url)) fieldErrors.url = "URL must start with http:// or https://";
  if (imageUrl && !URL_REGEX.test(imageUrl) && !STORAGE_URL_REGEX.test(imageUrl)) {
    fieldErrors.imageUrl = "Image URL must start with http://, https://, or storage://";
  }
  for (const entry of imageUrls) {
    if (!URL_REGEX.test(entry) && !STORAGE_URL_REGEX.test(entry)) {
      fieldErrors.imageUrls = "Each image URL must start with http://, https://, or storage://";
      break;
    }
  }
  if (imageUrls.length > IMAGE_LIMIT) {
    fieldErrors.imageUrls = `Up to ${IMAGE_LIMIT} images are allowed per item.`;
  }

  if (priceCents !== null && (!Number.isInteger(priceCents) || priceCents < 0)) {
    fieldErrors.priceCents = "Price must be a non-negative integer in cents.";
  }

  if (targetCents !== null && (!Number.isInteger(targetCents) || targetCents < 0)) {
    fieldErrors.targetCents = "Target must be a non-negative integer in cents.";
  }

  if (isGroupFunded && targetCents === null) {
    fieldErrors.targetCents = "Target is required when group funded is enabled.";
  }

  return {
    fieldErrors,
    value: {
      wishlistId,
      title,
      description,
      url,
      priceCents,
      imageUrl,
      imageUrls,
      isGroupFunded,
      targetCents: isGroupFunded ? targetCents : null,
    },
  };
}

export async function POST(request: NextRequest) {
  const ownerEmail = ownerEmailFromHeader(request);
  if (!ownerEmail) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required to create items.");
  }

  let payload: ItemPayload;
  try {
    payload = (await request.json()) as ItemPayload;
  } catch {
    return errorResponse(400, "VALIDATION_ERROR", "Invalid JSON payload.");
  }

  const validated = validatePayload(payload);
  if (Object.keys(validated.fieldErrors).length > 0) {
    return errorResponse(422, "VALIDATION_ERROR", "Please fix the highlighted fields.", validated.fieldErrors);
  }

  const ownerWishlists = await listWishlistRecords({
    ownerEmail,
    search: "",
    sort: "updated_desc",
    canonicalHost: process.env.CANONICAL_HOST,
  });

  const ownsWishlist = ownerWishlists.some((wishlist) => wishlist.id === validated.value.wishlistId);
  if (!ownsWishlist) {
    return errorResponse(403, "FORBIDDEN", "You do not have access to this wishlist.");
  }

  try {
    const created = await createItem({
      wishlistId: validated.value.wishlistId,
      ownerEmail,
      title: validated.value.title,
      description: validated.value.description,
      url: validated.value.url,
      priceCents: validated.value.priceCents,
      imageUrl: validated.value.imageUrl,
      imageUrls: validated.value.imageUrls,
      isGroupFunded: validated.value.isGroupFunded,
      targetCents: validated.value.targetCents,
    });

    return NextResponse.json(
      {
        ok: true as const,
        item: created.item,
        warning: created.duplicateUrl ? "DUPLICATE_URL" : null,
      },
      { status: 201 },
    );
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Unable to create item right now.");
  }
}

export async function GET(request: NextRequest) {
  const ownerEmail = ownerEmailFromHeader(request);
  if (!ownerEmail) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required to load items.");
  }

  const wishlistId = request.nextUrl.searchParams.get("wishlistId") || "";
  if (!wishlistId) {
    return errorResponse(422, "VALIDATION_ERROR", "Wishlist ID is required.", {
      wishlistId: "Wishlist ID is required.",
    });
  }

  const ownerWishlists = await listWishlistRecords({
    ownerEmail,
    search: "",
    sort: "updated_desc",
    canonicalHost: process.env.CANONICAL_HOST,
  });
  const ownsWishlist = ownerWishlists.some((wishlist) => wishlist.id === wishlistId);

  if (!ownsWishlist) {
    return errorResponse(403, "FORBIDDEN", "You do not have access to this wishlist.");
  }

  try {
    const items = await listItemsForWishlist({ wishlistId, ownerEmail });

    return NextResponse.json({
      ok: true as const,
      items,
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Unable to load items right now.");
  }
}
