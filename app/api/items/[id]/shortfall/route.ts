import { NextRequest, NextResponse } from "next/server";

import { resolveGroupFundingShortfall, type ResolveShortfallAction } from "@/app/_lib/item-store";
import { authenticateOwnerRequest } from "@/app/_lib/request-auth";

type ApiErrorCode = "AUTH_REQUIRED" | "VALIDATION_ERROR" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INTERNAL_ERROR";

type ShortfallPayload = {
  action?: ResolveShortfallAction;
};

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

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const owner = await authenticateOwner(request);
  if (owner instanceof NextResponse) return owner;

  const { id } = await context.params;

  let payload: ShortfallPayload;
  try {
    payload = (await request.json()) as ShortfallPayload;
  } catch {
    return errorResponse(400, "VALIDATION_ERROR", "Invalid JSON payload.");
  }

  const action = payload.action;
  if (action !== "extend_7d" && action !== "lower_target_to_funded" && action !== "archive_item") {
    return errorResponse(422, "VALIDATION_ERROR", "Invalid shortfall action.", {
      action: "Action must be one of: extend_7d, lower_target_to_funded, archive_item.",
    });
  }

  try {
    const resolved = await resolveGroupFundingShortfall({
      itemId: id,
      ownerEmail: owner.email,
      action,
    });

    if ("error" in resolved) {
      if (resolved.error === "NOT_FOUND") {
        return errorResponse(404, "NOT_FOUND", "Item not found.");
      }
      if (resolved.error === "FORBIDDEN") {
        return errorResponse(403, "FORBIDDEN", "You do not have access to this item.");
      }
      if (resolved.error === "TARGET_ALREADY_REACHED") {
        return errorResponse(409, "CONFLICT", "Target already reached. No shortfall to resolve.");
      }
      if (resolved.error === "NOT_GROUP_FUNDED") {
        return errorResponse(409, "CONFLICT", "This item is not group funded.");
      }
      if (resolved.error === "TARGET_UNSET") {
        return errorResponse(409, "CONFLICT", "Funding target is not set for this item.");
      }
      if (resolved.error === "ARCHIVED") {
        return errorResponse(409, "CONFLICT", "This item is archived.");
      }
      return errorResponse(409, "CONFLICT", "Unable to resolve shortfall for this item.");
    }

    return NextResponse.json({
      ok: true as const,
      item: resolved.item,
      appliedAction: resolved.appliedAction,
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Unable to resolve shortfall right now.");
  }
}
