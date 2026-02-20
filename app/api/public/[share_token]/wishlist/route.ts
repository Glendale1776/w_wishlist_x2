import { NextResponse } from "next/server";

import { resolvePublicWishlistReadModel } from "@/app/_lib/public-wishlist";

type ApiErrorCode = "NOT_FOUND";

function errorResponse(status: number, code: ApiErrorCode, message: string) {
  return NextResponse.json(
    {
      ok: false as const,
      error: {
        code,
        message,
      },
    },
    {
      status,
      headers: {
        "cache-control": "private, no-store, max-age=0",
      },
    },
  );
}

export async function GET(_request: Request, context: { params: Promise<{ share_token: string }> }) {
  const { share_token } = await context.params;

  const resolved = await resolvePublicWishlistReadModel({
    shareToken: share_token,
    canonicalHost: process.env.CANONICAL_HOST,
  });

  if (!resolved.ok) {
    return errorResponse(404, "NOT_FOUND", "This shared wishlist is unavailable.");
  }

  return NextResponse.json(
    {
      ok: true as const,
      version: resolved.model.version,
      wishlist: resolved.model.wishlist,
      items: resolved.model.items,
    },
    {
      headers: {
        "cache-control": "private, no-store, max-age=0",
      },
    },
  );
}
