import { NextRequest, NextResponse } from "next/server";

import { recordWishlistOpen } from "@/app/_lib/item-store";
import { resolvePublicWishlistByToken } from "@/app/_lib/wishlist-store";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ApiErrorCode = "AUTH_REQUIRED" | "NOT_FOUND" | "INTERNAL_ERROR";

function errorResponse(status: number, code: ApiErrorCode, message: string) {
  return NextResponse.json(
    {
      ok: false as const,
      error: {
        code,
        message,
      },
    },
    { status },
  );
}

function actorEmailFromHeader(request: NextRequest) {
  const value = request.headers.get("x-actor-email")?.trim().toLowerCase() || "";
  if (!EMAIL_REGEX.test(value)) return null;
  return value;
}

export async function POST(request: NextRequest, context: { params: Promise<{ share_token: string }> }) {
  const actorEmail = actorEmailFromHeader(request);
  if (!actorEmail) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required to track wishlist activity.");
  }

  const { share_token } = await context.params;
  const resolvedWishlist = await resolvePublicWishlistByToken(share_token);
  if ("error" in resolvedWishlist) {
    return errorResponse(404, "NOT_FOUND", "This shared wishlist is unavailable.");
  }

  try {
    const result = await recordWishlistOpen({
      wishlistId: resolvedWishlist.wishlist.id,
      actorEmail,
    });

    if ("error" in result) {
      return errorResponse(401, "AUTH_REQUIRED", "Sign in is required to track wishlist activity.");
    }

    return NextResponse.json({
      ok: true as const,
      openCount: result.openCount,
      lastOpenedAt: result.lastOpenedAt,
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Unable to track wishlist open right now.");
  }
}
