import { NextRequest, NextResponse } from "next/server";

import {
  consumeActionRateLimit,
  readIdempotency,
  reservePublicItem,
  unreservePublicItem,
  writeIdempotency,
} from "@/app/_lib/item-store";
import { resolvePublicWishlistByToken } from "@/app/_lib/wishlist-store";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_RATE_LIMIT_ACTIONS_PER_MIN = 20;
const DEFAULT_IDEMPOTENCY_TTL_SEC = 180;

type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "IDEMPOTENCY_KEY_REUSED";

type ReservationPayload = {
  itemId?: string;
  action?: "reserve" | "unreserve";
};

function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  options?: {
    fieldErrors?: Record<string, string>;
    retryAfterSec?: number;
  },
) {
  return NextResponse.json(
    {
      ok: false as const,
      error: {
        code,
        message,
        fieldErrors: options?.fieldErrors,
        retryAfterSec: options?.retryAfterSec,
      },
    },
    {
      status,
      headers: options?.retryAfterSec
        ? {
            "retry-after": String(options.retryAfterSec),
          }
        : undefined,
    },
  );
}

function actorEmailFromHeader(request: NextRequest) {
  const value = request.headers.get("x-actor-email")?.trim().toLowerCase() || "";
  if (!EMAIL_REGEX.test(value)) return null;
  return value;
}

function parsePositiveInt(raw: string | undefined, fallback: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parseClientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const first = forwarded.split(",")[0]?.trim();
  if (first) return first;

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}

function idempotencyTtlSec() {
  return parsePositiveInt(process.env.IDEMPOTENCY_TTL_SEC, DEFAULT_IDEMPOTENCY_TTL_SEC);
}

function actionRateLimitPerMin() {
  return parsePositiveInt(process.env.RATE_LIMIT_ACTIONS_PER_MIN, DEFAULT_RATE_LIMIT_ACTIONS_PER_MIN);
}

function idempotencyHeader(request: NextRequest) {
  return request.headers.get("x-idempotency-key")?.trim() || "";
}

export async function POST(request: NextRequest, context: { params: Promise<{ share_token: string }> }) {
  const actorEmail = actorEmailFromHeader(request);
  if (!actorEmail) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required for this action.");
  }

  const idempotencyKey = idempotencyHeader(request);
  if (!idempotencyKey) {
    return errorResponse(422, "VALIDATION_ERROR", "Idempotency key is required.", {
      fieldErrors: {
        idempotencyKey: "Idempotency key is required.",
      },
    });
  }

  let payload: ReservationPayload;
  try {
    payload = (await request.json()) as ReservationPayload;
  } catch {
    return errorResponse(400, "VALIDATION_ERROR", "Invalid JSON payload.");
  }

  const action = payload.action === "unreserve" ? "unreserve" : "reserve";
  const itemId = (payload.itemId || "").trim();

  if (!itemId) {
    return errorResponse(422, "VALIDATION_ERROR", "Item is required.", {
      fieldErrors: {
        itemId: "Item is required.",
      },
    });
  }

  const { share_token } = await context.params;
  const resolvedWishlist = await resolvePublicWishlistByToken(share_token);
  if ("error" in resolvedWishlist) {
    return errorResponse(404, "NOT_FOUND", "This shared wishlist is unavailable.");
  }

  const scope = `reservation:${share_token}`;
  const idempotencyPayload = {
    shareToken: share_token,
    itemId,
    action,
  };

  const existing = readIdempotency({
    scope,
    actorEmail,
    key: idempotencyKey,
    payload: idempotencyPayload,
  });

  if (existing.kind === "payload_mismatch") {
    return errorResponse(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key cannot be reused for a different request.");
  }

  if (existing.kind === "cached") {
    return NextResponse.json(existing.body, {
      status: existing.status,
      headers: {
        "x-idempotent-replay": "1",
      },
    });
  }

  const rateResult = consumeActionRateLimit({
    scope: "public-actions",
    actorEmail,
    ipAddress: parseClientIp(request),
    limitPerMin: actionRateLimitPerMin(),
  });

  if (!rateResult.ok) {
    return errorResponse(429, "RATE_LIMITED", "Too many actions. Try again shortly.", {
      retryAfterSec: rateResult.retryAfterSec,
    });
  }

  const mutation =
    action === "reserve"
      ? reservePublicItem({
          wishlistId: resolvedWishlist.wishlist.id,
          itemId,
          actorEmail,
        })
      : unreservePublicItem({
          wishlistId: resolvedWishlist.wishlist.id,
          itemId,
          actorEmail,
        });

  if ("error" in mutation) {
    if (mutation.error === "NOT_FOUND") {
      return errorResponse(404, "NOT_FOUND", "Item not found.");
    }

    if (mutation.error === "ALREADY_RESERVED") {
      return errorResponse(409, "CONFLICT", "Item is already reserved.");
    }

    if (mutation.error === "NO_ACTIVE_RESERVATION") {
      return errorResponse(409, "CONFLICT", "You do not have an active reservation for this item.");
    }

    return errorResponse(409, "CONFLICT", "This action is unavailable for archived items.");
  }

  const responseBody = {
    ok: true as const,
    reservation: {
      status: mutation.reservationStatus,
    },
    item: mutation.item,
  };

  writeIdempotency({
    scope,
    actorEmail,
    key: idempotencyKey,
    payload: idempotencyPayload,
    status: 200,
    body: responseBody,
    ttlSec: idempotencyTtlSec(),
  });

  return NextResponse.json(responseBody);
}
