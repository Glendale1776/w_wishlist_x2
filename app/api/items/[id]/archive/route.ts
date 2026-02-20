import { NextRequest, NextResponse } from "next/server";

import { archiveItem, restoreArchivedItem } from "@/app/_lib/item-store";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  let result: Awaited<ReturnType<typeof archiveItem>>;
  try {
    result = await archiveItem({ itemId: id, ownerEmail });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Unable to archive item right now.");
  }

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

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ownerEmail = ownerEmailFromHeader(request);
  if (!ownerEmail) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required to restore archived items.");
  }

  const { id } = await context.params;

  let result: Awaited<ReturnType<typeof restoreArchivedItem>>;
  try {
    result = await restoreArchivedItem({ itemId: id, ownerEmail });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Unable to restore item right now.");
  }

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
