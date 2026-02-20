import { NextRequest, NextResponse } from "next/server";

import { updateItem } from "@/app/_lib/item-store";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_REGEX = /^https?:\/\//i;
const STORAGE_URL_REGEX = /^storage:\/\//i;
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 600;
const IMAGE_LIMIT = 10;

type ApiErrorCode = "AUTH_REQUIRED" | "VALIDATION_ERROR" | "FORBIDDEN" | "NOT_FOUND" | "INTERNAL_ERROR";

type ItemPayload = {
  title?: string;
  description?: string | null;
  url?: string | null;
  priceCents?: number | null;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  isGroupFunded?: boolean;
  targetCents?: number | null;
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

function ownerEmailFromHeader(request: NextRequest) {
  const value = request.headers.get("x-owner-email")?.trim().toLowerCase() || "";
  if (!EMAIL_REGEX.test(value)) return null;
  return value;
}

function validatePayload(body: ItemPayload) {
  const fieldErrors: Record<string, string> = {};
  const title = (body.title || "").trim();
  const description = body.description?.trim() || null;
  const url = body.url?.trim() || null;
  const imageUrl = body.imageUrl?.trim() || null;
  const imageUrls = Array.isArray(body.imageUrls)
    ? body.imageUrls.map((value) => (value || "").trim()).filter(Boolean)
    : [];
  const priceCents = body.priceCents ?? null;
  const isGroupFunded = Boolean(body.isGroupFunded);
  const targetCents = body.targetCents ?? null;

  if (!title) fieldErrors.title = "Item title is required.";
  if (title.length > TITLE_MAX) fieldErrors.title = `Item title must be ${TITLE_MAX} chars or less.`;
  if (description && description.length > DESCRIPTION_MAX) {
    fieldErrors.description = `Description must be ${DESCRIPTION_MAX} chars or less.`;
  }

  if (url && !URL_REGEX.test(url)) fieldErrors.url = "URL must start with http:// or https://";
  if (imageUrl && !URL_REGEX.test(imageUrl) && !STORAGE_URL_REGEX.test(imageUrl)) {
    fieldErrors.imageUrl = "Image URL must start with http://, https://, or storage://";
  }
  for (const entry of imageUrls) {
    if (!URL_REGEX.test(entry) && !STORAGE_URL_REGEX.test(entry)) {
      fieldErrors.imageUrls = "Each image URL must start with http://, https://, or storage://";
      break;
    }
  }
  if (imageUrls.length > IMAGE_LIMIT) {
    fieldErrors.imageUrls = `Up to ${IMAGE_LIMIT} images are allowed per item.`;
  }

  if (priceCents !== null && (!Number.isInteger(priceCents) || priceCents < 0)) {
    fieldErrors.priceCents = "Price must be a non-negative integer in cents.";
  }

  if (targetCents !== null && (!Number.isInteger(targetCents) || targetCents < 0)) {
    fieldErrors.targetCents = "Target must be a non-negative integer in cents.";
  }

  if (isGroupFunded && targetCents === null) {
    fieldErrors.targetCents = "Target is required when group funded is enabled.";
  }

  return {
    fieldErrors,
    value: {
      title,
      description,
      url,
      priceCents,
      imageUrl,
      imageUrls,
      isGroupFunded,
      targetCents: isGroupFunded ? targetCents : null,
    },
  };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ownerEmail = ownerEmailFromHeader(request);
  if (!ownerEmail) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required to update items.");
  }

  let payload: ItemPayload;
  try {
    payload = (await request.json()) as ItemPayload;
  } catch {
    return errorResponse(400, "VALIDATION_ERROR", "Invalid JSON payload.");
  }

  const validated = validatePayload(payload);
  if (Object.keys(validated.fieldErrors).length > 0) {
    return errorResponse(422, "VALIDATION_ERROR", "Please fix the highlighted fields.", validated.fieldErrors);
  }

  const { id } = await context.params;

  let updated: Awaited<ReturnType<typeof updateItem>>;
  try {
    updated = await updateItem({
      itemId: id,
      ownerEmail,
      title: validated.value.title,
      description: validated.value.description,
      url: validated.value.url,
      priceCents: validated.value.priceCents,
      imageUrl: validated.value.imageUrl,
      imageUrls: validated.value.imageUrls,
      isGroupFunded: validated.value.isGroupFunded,
      targetCents: validated.value.targetCents,
    });
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Unable to update item right now.");
  }

  if ("error" in updated) {
    if (updated.error === "NOT_FOUND") {
      return errorResponse(404, "NOT_FOUND", "Item not found.");
    }
    return errorResponse(403, "FORBIDDEN", "You do not have access to this item.");
  }

  return NextResponse.json({
    ok: true as const,
    item: updated.item,
    warning: updated.duplicateUrl ? "DUPLICATE_URL" : null,
  });
}
