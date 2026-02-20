import { NextRequest, NextResponse } from "next/server";

import { listActivityForActor } from "@/app/_lib/item-store";
import { getPublicShareTokenForWishlist, getWishlistRecordById } from "@/app/_lib/wishlist-store";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ApiErrorCode = "AUTH_REQUIRED";

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

export async function GET(request: NextRequest) {
  const actorEmail = actorEmailFromHeader(request);
  if (!actorEmail) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required to view activity.");
  }

  const wishlistIdFilter = request.nextUrl.searchParams.get("wishlistId")?.trim() || null;

  const rows = await listActivityForActor({ actorEmail });

  const filteredRows = rows.filter((row) => (wishlistIdFilter ? row.wishlistId === wishlistIdFilter : true));
  const activities = await Promise.all(
    filteredRows.map(async (row) => {
      const [wishlist, shareToken] = await Promise.all([
        getWishlistRecordById(row.wishlistId),
        getPublicShareTokenForWishlist(row.wishlistId),
      ]);

      return {
        id: row.id,
        kind: row.kind,
        action: row.action,
        wishlistId: row.wishlistId,
        wishlistTitle: wishlist?.title || "Wishlist",
        itemId: row.itemId,
        itemTitle: row.itemTitle,
        amountCents: row.amountCents,
        status: row.status,
        openCount: row.openCount,
        happenedAt: row.happenedAt,
        openItemPath: shareToken
          ? row.itemId
            ? `/l/${shareToken}?item=${row.itemId}`
            : `/l/${shareToken}`
          : null,
      };
    }),
  );

  return NextResponse.json({
    ok: true as const,
    activities,
  });
}
