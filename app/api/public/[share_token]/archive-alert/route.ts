import { NextRequest, NextResponse } from "next/server";

import { getLatestPendingArchiveAlert, markArchiveAlertSeen } from "@/app/_lib/archive-alerts";
import { resolvePublicWishlistByToken } from "@/app/_lib/wishlist-store";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ApiErrorCode = "AUTH_REQUIRED" | "NOT_FOUND" | "VALIDATION_ERROR" | "INTERNAL_ERROR";

function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  fieldErrors?: Record<string, string>,
) {
  return NextResponse.json(
    {
      ok: false as const,
      error: {
        code,
        message,
        fieldErrors,
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

export async function GET(request: NextRequest, context: { params: Promise<{ share_token: string }> }) {
  const actorEmail = actorEmailFromHeader(request);
  if (!actorEmail) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required for archive alerts.");
  }

  const { share_token } = await context.params;
  const resolvedWishlist = await resolvePublicWishlistByToken(share_token);
  if ("error" in resolvedWishlist) {
    return errorResponse(404, "NOT_FOUND", "This shared wishlist is unavailable.");
  }

  try {
    const result = await getLatestPendingArchiveAlert({
      wishlistId: resolvedWishlist.wishlist.id,
      actorEmail,
    });

    if ("error" in result) {
      return errorResponse(401, "AUTH_REQUIRED", "Sign in is required for archive alerts.");
    }

    return NextResponse.json({
      ok: true as const,
      alert: result.alert,
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Unable to load archive alerts.");
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ share_token: string }> }) {
  const actorEmail = actorEmailFromHeader(request);
  if (!actorEmail) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required for archive alerts.");
  }

  const { share_token } = await context.params;
  const resolvedWishlist = await resolvePublicWishlistByToken(share_token);
  if ("error" in resolvedWishlist) {
    return errorResponse(404, "NOT_FOUND", "This shared wishlist is unavailable.");
  }

  const payload = (await request.json().catch(() => null)) as { notificationId?: string } | null;
  const notificationId = payload?.notificationId?.trim() || "";
  if (!notificationId) {
    return errorResponse(422, "VALIDATION_ERROR", "Notification id is required.", {
      notificationId: "Notification id is required.",
    });
  }

  try {
    const result = await markArchiveAlertSeen({
      notificationId,
      wishlistId: resolvedWishlist.wishlist.id,
      actorEmail,
    });
    if ("error" in result) {
      return errorResponse(401, "AUTH_REQUIRED", "Sign in is required for archive alerts.");
    }

    return NextResponse.json({
      ok: true as const,
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Unable to update archive alert.");
  }
}
