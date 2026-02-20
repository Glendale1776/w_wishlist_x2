import { NextRequest, NextResponse } from "next/server";

import { deleteItemsForWishlist } from "@/app/_lib/item-store";
import { authenticateOwnerRequest } from "@/app/_lib/request-auth";
import { deleteWishlistRecord } from "@/app/_lib/wishlist-store";

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

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const owner = await authenticateOwnerRequest(request);
  if (!owner.ok) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required to delete a wishlist.");
  }

  const { id } = await context.params;

  try {
    const deleted = await deleteWishlistRecord({
      wishlistId: id,
      ownerEmail: owner.email,
      ownerId: owner.userId,
    });

    if ("error" in deleted) {
      if (deleted.error === "NOT_FOUND") {
        return errorResponse(404, "NOT_FOUND", "Wishlist not found.");
      }
      return errorResponse(403, "FORBIDDEN", "You do not have access to this wishlist.");
    }

    deleteItemsForWishlist({
      wishlistId: id,
      ownerEmail: owner.email,
    });

    return NextResponse.json({
      ok: true as const,
      deletedWishlistId: deleted.wishlistId,
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Unable to delete wishlist right now.");
  }
}
