import { NextRequest, NextResponse } from "next/server";

import {
  consumeActionRateLimit,
  contributeToPublicItem,
  hydratePublicItemImage,
  readIdempotency,
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

type ContributionPayload = {
  itemId?: string;
  amountCents?: number;
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

  let payload: ContributionPayload;
  try {
    payload = (await request.json()) as ContributionPayload;
  } catch {
    return errorResponse(400, "VALIDATION_ERROR", "Invalid JSON payload.");
  }

  const itemId = (payload.itemId || "").trim();
  const amountCents = payload.amountCents;

  const fieldErrors: Record<string, string> = {};
  if (!itemId) {
    fieldErrors.itemId = "Item is required.";
  }
  if (!Number.isInteger(amountCents ?? null)) {
    fieldErrors.amountCents = "Amount must be an integer in cents.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return errorResponse(422, "VALIDATION_ERROR", "Please fix the highlighted fields.", {
      fieldErrors,
    });
  }

  const { share_token } = await context.params;
  const resolvedWishlist = await resolvePublicWishlistByToken(share_token);
  if ("error" in resolvedWishlist) {
    return errorResponse(404, "NOT_FOUND", "This shared wishlist is unavailable.");
  }

  const scope = `contribution:${share_token}`;
  const idempotencyPayload = {
    shareToken: share_token,
    itemId,
    amountCents,
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

  const mutation = await contributeToPublicItem({
    wishlistId: resolvedWishlist.wishlist.id,
    itemId,
    actorEmail,
    amountCents: amountCents as number,
  });

  if ("error" in mutation) {
    if (mutation.error === "NOT_FOUND") {
      return errorResponse(404, "NOT_FOUND", "Item not found.");
    }

    if (mutation.error === "ACTOR_NOT_FOUND") {
      return errorResponse(401, "AUTH_REQUIRED", "Sign in is required for this action.");
    }

    if (mutation.error === "INVALID_AMOUNT") {
      return errorResponse(422, "VALIDATION_ERROR", "Contribution must be at least 1.00.", {
        fieldErrors: {
          amountCents: "Contribution must be at least 1.00.",
        },
      });
    }

    if (mutation.error === "NOT_GROUP_FUNDED") {
      return errorResponse(409, "CONFLICT", "This item does not accept contributions.");
    }

    return errorResponse(409, "CONFLICT", "This action is unavailable for archived items.");
  }

  const hydratedItem = await hydratePublicItemImage(mutation.item);

  const responseBody = {
    ok: true as const,
    contribution: {
      id: mutation.contribution.id,
      amountCents: mutation.contribution.amountCents,
      createdAt: mutation.contribution.createdAt,
    },
    item: hydratedItem,
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
