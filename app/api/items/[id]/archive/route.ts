import { NextRequest, NextResponse } from "next/server";

import { archiveItem } from "@/app/_lib/item-store";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ApiErrorCode = "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND";

function errorResponse(status: number, code: ApiErrorCode, message: string) {
  return NextResponse.json(
    {
      ok: false as const,
      error: { code, message },
    },
    { status },
  );
}

function ownerEmailFromHeader(request: NextRequest) {
  const value = request.headers.get("x-owner-email")?.trim().toLowerCase() || "";
  if (!EMAIL_REGEX.test(value)) return null;
  return value;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ownerEmail = ownerEmailFromHeader(request);
  if (!ownerEmail) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required to archive items.");
  }

  const { id } = await context.params;
  const result = archiveItem({ itemId: id, ownerEmail });

  if ("error" in result) {
    if (result.error === "NOT_FOUND") {
      return errorResponse(404, "NOT_FOUND", "Item not found.");
    }
    return errorResponse(403, "FORBIDDEN", "You do not have access to this item.");
  }

  return NextResponse.json({
    ok: true as const,
    item: result.item,
  });
}
