import { NextRequest, NextResponse } from "next/server";

import { authenticateOwnerRequest } from "@/app/_lib/request-auth";
import { rotateWishlistShareLink } from "@/app/_lib/wishlist-store";

const DEFAULT_SHARE_TOKEN_BYTES = 24;
const DEFAULT_IDEMPOTENCY_TTL_SEC = 180;

type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

function errorResponse(status: number, code: ApiErrorCode, message: string, fieldErrors?: Record<string, string>) {
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

function parsePositiveInt(raw: string | undefined, fallback: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const owner = await authenticateOwnerRequest(request);
  if (!owner.ok) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required to rotate the share link.");
  }

  const idempotencyKey = request.headers.get("x-idempotency-key")?.trim() || "";
  if (!idempotencyKey) {
    return errorResponse(422, "VALIDATION_ERROR", "Idempotency key is required.", {
      idempotencyKey: "Idempotency key is required.",
    });
  }

  const { id } = await context.params;

  try {
    const rotated = await rotateWishlistShareLink({
      wishlistId: id,
      ownerEmail: owner.email,
      ownerId: owner.userId,
      canonicalHost: process.env.CANONICAL_HOST,
      shareTokenBytes: parsePositiveInt(process.env.SHARE_TOKEN_BYTES, DEFAULT_SHARE_TOKEN_BYTES),
      shareTokenPepper: process.env.SHARE_TOKEN_PEPPER,
      idempotencyKey,
      idempotencyTtlSec: parsePositiveInt(process.env.IDEMPOTENCY_TTL_SEC, DEFAULT_IDEMPOTENCY_TTL_SEC),
    });

    if ("error" in rotated) {
      if (rotated.error === "NOT_FOUND") {
        return errorResponse(404, "NOT_FOUND", "Wishlist not found.");
      }
      return errorResponse(403, "FORBIDDEN", "You do not have access to rotate this wishlist link.");
    }

    if (rotated.alreadyProcessed) {
      return NextResponse.json({
        ok: true as const,
        alreadyProcessed: true as const,
        rotatedAt: rotated.rotatedAt,
        shareUrl: null,
        shareUrlPreview: null,
      });
    }

    return NextResponse.json({
      ok: true as const,
      alreadyProcessed: false as const,
      rotatedAt: rotated.rotatedAt,
      shareUrl: rotated.shareUrl,
      shareUrlPreview: rotated.shareUrlPreview,
      auditEventId: rotated.auditEventId,
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Unable to rotate share link right now.");
  }
}
