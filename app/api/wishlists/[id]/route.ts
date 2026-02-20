import { NextRequest, NextResponse } from "next/server";

import { deleteItemsForWishlist } from "@/app/_lib/item-store";
import { deleteWishlistRecord } from "@/app/_lib/wishlist-store";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ApiErrorCode = "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "INTERNAL_ERROR";

function errorResponse(status: number, code: ApiErrorCode, message: string) {
  return NextResponse.json(
    {
      ok: false as const,
      error: { code, message },
    },
    { status },
  );
}

function getOwnerEmail(request: NextRequest): string | null {
  const value = request.headers.get("x-owner-email")?.trim().toLowerCase() || "";
  if (!value || !EMAIL_REGEX.test(value)) return null;
  return value;
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required to delete a wishlist.");
  }

  const { id } = await context.params;

  try {
    const deleted = deleteWishlistRecord({
      wishlistId: id,
      ownerEmail,
    });

    if ("error" in deleted) {
      if (deleted.error === "NOT_FOUND") {
        return errorResponse(404, "NOT_FOUND", "Wishlist not found.");
      }
      return errorResponse(403, "FORBIDDEN", "You do not have access to this wishlist.");
    }

    deleteItemsForWishlist({
      wishlistId: id,
      ownerEmail,
    });

    return NextResponse.json({
      ok: true as const,
      deletedWishlistId: deleted.wishlistId,
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Unable to delete wishlist right now.");
  }
}
