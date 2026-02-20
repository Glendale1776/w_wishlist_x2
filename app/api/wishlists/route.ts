import { NextRequest, NextResponse } from "next/server";

import { authenticateOwnerRequest } from "@/app/_lib/request-auth";
import { createWishlistRecord, listWishlistRecords, WishlistSort } from "@/app/_lib/wishlist-store";

const CURRENCY_REGEX = /^[A-Z]{3}$/;
const TITLE_MAX = 80;
const NOTE_MAX = 200;

type ApiErrorCode = "AUTH_REQUIRED" | "FORBIDDEN" | "VALIDATION_ERROR" | "INTERNAL_ERROR";

function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  fieldErrors?: Record<string, string>,
) {
  return NextResponse.json(
    {
      ok: false as const,
      error: { code, message, fieldErrors },
    },
    { status },
  );
}

async function resolveOwnerIdentity(request: NextRequest): Promise<{ email: string; userId: string } | null> {
  const auth = await authenticateOwnerRequest(request);
  if (!auth.ok) return null;
  return auth;
}

function parseSort(value: string | null): WishlistSort {
  return value === "title_asc" ? "title_asc" : "updated_desc";
}

export async function GET(request: NextRequest) {
  const owner = await resolveOwnerIdentity(request);
  if (!owner) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required to access wishlists.");
  }

  const searchParams = request.nextUrl.searchParams;
  const search = searchParams.get("search") || "";
  const sort = parseSort(searchParams.get("sort"));

  const wishlists = await listWishlistRecords({
    ownerEmail: owner.email,
    ownerId: owner.userId,
    search,
    sort,
    canonicalHost: process.env.CANONICAL_HOST,
  });

  return NextResponse.json({
    ok: true as const,
    wishlists,
  });
}

export async function POST(request: NextRequest) {
  const owner = await resolveOwnerIdentity(request);
  if (!owner) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required to create a wishlist.");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse(400, "VALIDATION_ERROR", "Invalid JSON payload.");
  }

  const body = (payload ?? {}) as {
    title?: string;
    occasionDate?: string | null;
    occasionNote?: string | null;
    currency?: string | null;
  };

  const title = (body.title || "").trim();
  const occasionDate = body.occasionDate?.trim() || null;
  const occasionNote = body.occasionNote?.trim() || null;
  const currency = (body.currency || "USD").trim().toUpperCase();

  const fieldErrors: Record<string, string> = {};
  if (!title) fieldErrors.title = "Wishlist title is required.";
  if (title.length > TITLE_MAX) fieldErrors.title = `Title must be ${TITLE_MAX} characters or less.`;
  if (occasionNote && occasionNote.length > NOTE_MAX) {
    fieldErrors.occasionNote = `Occasion note must be ${NOTE_MAX} characters or less.`;
  }
  if (!CURRENCY_REGEX.test(currency)) {
    fieldErrors.currency = "Currency must be a 3-letter uppercase code.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return errorResponse(422, "VALIDATION_ERROR", "Please fix the highlighted fields.", fieldErrors);
  }

  try {
    const created = await createWishlistRecord({
      ownerEmail: owner.email,
      ownerId: owner.userId,
      title,
      occasionDate,
      occasionNote,
      currency,
      canonicalHost: process.env.CANONICAL_HOST,
    });

    return NextResponse.json(
      {
        ok: true as const,
        wishlist: {
          id: created.record.id,
          title: created.record.title,
          occasionDate: created.record.occasionDate,
          occasionNote: created.record.occasionNote,
          currency: created.record.currency,
          updatedAt: created.record.updatedAt,
          shareUrl: created.shareUrl,
          shareUrlPreview: created.shareUrlPreview,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "OWNER_NOT_FOUND") {
      return errorResponse(401, "AUTH_REQUIRED", "Sign in is required to create a wishlist.");
    }
    return errorResponse(500, "INTERNAL_ERROR", "Unable to create wishlist right now.");
  }
}
