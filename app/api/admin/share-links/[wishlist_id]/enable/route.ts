import { NextRequest, NextResponse } from "next/server";

import { updateWishlistShareLinkDisabled } from "@/app/_lib/wishlist-store";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ApiErrorCode = "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "INTERNAL_ERROR";

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

function parseAdminAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => EMAIL_REGEX.test(value)),
  );
}

function adminEmailFromHeader(request: NextRequest) {
  const value = request.headers.get("x-admin-email")?.trim().toLowerCase() || "";
  if (!EMAIL_REGEX.test(value)) return null;
  return value;
}

function isAuthorizedAdmin(adminEmail: string): boolean {
  const allowlist = parseAdminAllowlist(process.env.ADMIN_EMAILS);
  if (allowlist.size === 0) return false;
  return allowlist.has(adminEmail);
}

export async function POST(request: NextRequest, context: { params: Promise<{ wishlist_id: string }> }) {
  const adminEmail = adminEmailFromHeader(request);
  if (!adminEmail) {
    return errorResponse(401, "AUTH_REQUIRED", "Admin sign in is required.");
  }

  if (!isAuthorizedAdmin(adminEmail)) {
    return errorResponse(403, "FORBIDDEN", "Admin role is required.");
  }

  const { wishlist_id } = await context.params;

  try {
    const updated = updateWishlistShareLinkDisabled({
      wishlistId: wishlist_id,
      actorEmail: adminEmail,
      disabled: false,
    });

    if ("error" in updated) {
      return errorResponse(404, "NOT_FOUND", "Wishlist not found.");
    }

    return NextResponse.json({
      ok: true as const,
      alreadyEnabled: updated.alreadyApplied,
      auditEventId: updated.auditEventId,
      wishlist: {
        id: updated.wishlist.id,
        title: updated.wishlist.title,
        shareTokenDisabledAt: updated.wishlist.shareTokenDisabledAt,
      },
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Unable to re-enable this share link right now.");
  }
}
