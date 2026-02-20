import { NextRequest, NextResponse } from "next/server";

import { deleteItemsForWishlist } from "@/app/_lib/item-store";
import { authenticateOwnerRequest } from "@/app/_lib/request-auth";
import { deleteWishlistRecord, updateWishlistRecord } from "@/app/_lib/wishlist-store";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TITLE_MAX = 80;
const NOTE_MAX = 200;

type ApiErrorCode = "AUTH_REQUIRED" | "VALIDATION_ERROR" | "FORBIDDEN" | "NOT_FOUND" | "INTERNAL_ERROR";

function errorResponse(status: number, code: ApiErrorCode, message: string, fieldErrors?: Record<string, string>) {
  return NextResponse.json(
    {
      ok: false as const,
      error: { code, message, fieldErrors },
    },
    { status },
  );
}

async function authenticateOwner(request: NextRequest) {
  const owner = await authenticateOwnerRequest(request);
  if (!owner.ok) {
    if (owner.code === "AUTH_TIMEOUT") {
      return errorResponse(503, "INTERNAL_ERROR", "Auth verification timed out. Please retry.");
    }
    if (owner.code === "AUTH_MISMATCH") {
      return errorResponse(403, "FORBIDDEN", "Request owner does not match the signed-in account.");
    }
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required.");
  }

  return owner;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const owner = await authenticateOwner(request);
  if (owner instanceof NextResponse) {
    return owner;
  }

  const { id } = await context.params;

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
  };

  const title = (body.title || "").trim();
  const occasionDate = body.occasionDate?.trim() || null;
  const occasionNote = body.occasionNote?.trim() || null;

  const fieldErrors: Record<string, string> = {};
  if (!title) fieldErrors.title = "Wishlist title is required.";
  if (title.length > TITLE_MAX) fieldErrors.title = `Title must be ${TITLE_MAX} characters or less.`;
  if (occasionDate && !DATE_REGEX.test(occasionDate)) {
    fieldErrors.occasionDate = "Occasion date must use YYYY-MM-DD format.";
  }
  if (occasionNote && occasionNote.length > NOTE_MAX) {
    fieldErrors.occasionNote = `Occasion note must be ${NOTE_MAX} characters or less.`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return errorResponse(422, "VALIDATION_ERROR", "Please fix the highlighted fields.", fieldErrors);
  }

  try {
    const updated = await updateWishlistRecord({
      wishlistId: id,
      ownerEmail: owner.email,
      ownerId: owner.userId,
      title,
      occasionDate,
      occasionNote,
      canonicalHost: process.env.CANONICAL_HOST,
    });

    if ("error" in updated) {
      if (updated.error === "NOT_FOUND") {
        return errorResponse(404, "NOT_FOUND", "Wishlist not found.");
      }
      return errorResponse(403, "FORBIDDEN", "You do not have access to this wishlist.");
    }

    return NextResponse.json({
      ok: true as const,
      wishlist: {
        id: updated.wishlist.id,
        title: updated.wishlist.title,
        occasionDate: updated.wishlist.occasionDate,
        occasionNote: updated.wishlist.occasionNote,
        currency: updated.wishlist.currency,
        updatedAt: updated.wishlist.updatedAt,
        shareUrlPreview: updated.shareUrlPreview,
      },
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Unable to update wishlist right now.");
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const owner = await authenticateOwner(request);
  if (owner instanceof NextResponse) {
    return owner;
  }

  const { id } = await context.params;

  try {
    await deleteItemsForWishlist({
      wishlistId: id,
      ownerEmail: owner.email,
      ownerId: owner.userId,
    });

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

    return NextResponse.json({
      ok: true as const,
      deletedWishlistId: deleted.wishlistId,
    });
  } catch (error) {
    console.error("wishlist_delete_failed", {
      wishlistId: id,
      ownerId: owner.userId,
      ownerEmail: owner.email,
      error: error instanceof Error ? error.message : "unknown",
    });
    return errorResponse(500, "INTERNAL_ERROR", "Unable to delete wishlist right now.");
  }
}
