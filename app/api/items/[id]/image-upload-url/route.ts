import { NextRequest, NextResponse } from "next/server";

import {
  createItemImagePreview,
  prepareItemImageUpload,
  resolveItemImagePreview,
  uploadItemImage,
} from "@/app/_lib/item-store";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_MAX_UPLOAD_MB = 10;
const DEFAULT_ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const DEFAULT_SIGNED_URL_TTL_SEC = 300;

type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_UPLOAD_TOKEN"
  | "INVALID_PREVIEW_TOKEN";

type UploadUrlPayload = {
  mode?: "prepare-upload" | "preview";
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
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

function parsePositiveInt(raw: string | undefined, fallback: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function maxUploadBytes() {
  return parsePositiveInt(process.env.MAX_UPLOAD_MB, DEFAULT_MAX_UPLOAD_MB) * 1024 * 1024;
}

function allowedMimeTypes() {
  const fromEnv = (process.env.ALLOWED_IMAGE_MIME || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  const list = fromEnv.length > 0 ? fromEnv : DEFAULT_ALLOWED_IMAGE_MIME;
  return Array.from(new Set(list));
}

function signedUrlTtlSeconds() {
  const parsed = parsePositiveInt(process.env.SIGNED_URL_TTL_SEC, DEFAULT_SIGNED_URL_TTL_SEC);
  return Math.min(Math.max(parsed, 30), 3600);
}

function buildUploadUrl(itemId: string, uploadToken: string) {
  return `/api/items/${encodeURIComponent(itemId)}/image-upload-url?uploadToken=${encodeURIComponent(uploadToken)}`;
}

function buildPreviewUrl(itemId: string, previewToken: string) {
  return `/api/items/${encodeURIComponent(itemId)}/image-upload-url?previewToken=${encodeURIComponent(previewToken)}`;
}

function mapPrepareUploadError(code: string) {
  if (code === "NOT_FOUND") return errorResponse(404, "NOT_FOUND", "Item not found.");
  if (code === "FORBIDDEN") return errorResponse(403, "FORBIDDEN", "You do not have access to this item.");
  if (code === "ARCHIVED") return errorResponse(409, "VALIDATION_ERROR", "Archived items cannot accept uploads.");
  if (code === "INVALID_MIME") {
    return errorResponse(422, "VALIDATION_ERROR", "Unsupported image type.", {
      mimeType: "Unsupported image type.",
    });
  }
  if (code === "FILE_TOO_LARGE") {
    return errorResponse(422, "VALIDATION_ERROR", "Image exceeds maximum size.", {
      sizeBytes: "Image exceeds maximum size.",
    });
  }
  return errorResponse(422, "VALIDATION_ERROR", "Image size is invalid.", {
    sizeBytes: "Image size is invalid.",
  });
}

function mapUploadError(code: string) {
  if (code === "INVALID_UPLOAD_TOKEN") {
    return errorResponse(410, "INVALID_UPLOAD_TOKEN", "Upload URL expired. Request a new one.");
  }
  if (code === "FORBIDDEN") return errorResponse(403, "FORBIDDEN", "You do not have access to this upload.");
  if (code === "NOT_FOUND") return errorResponse(404, "NOT_FOUND", "Item not found.");
  if (code === "ARCHIVED") return errorResponse(409, "VALIDATION_ERROR", "Archived items cannot accept uploads.");
  if (code === "INVALID_MIME") {
    return errorResponse(422, "VALIDATION_ERROR", "Uploaded file type does not match request.", {
      mimeType: "Uploaded file type does not match request.",
    });
  }
  if (code === "FILE_TOO_LARGE") {
    return errorResponse(422, "VALIDATION_ERROR", "Uploaded file exceeds maximum size.", {
      sizeBytes: "Uploaded file exceeds maximum size.",
    });
  }
  return errorResponse(422, "VALIDATION_ERROR", "Uploaded file is empty or invalid.", {
    sizeBytes: "Uploaded file is empty or invalid.",
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ownerEmail = ownerEmailFromHeader(request);
  if (!ownerEmail) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required for image upload actions.");
  }

  const { id } = await context.params;

  let payload: UploadUrlPayload;
  try {
    payload = (await request.json()) as UploadUrlPayload;
  } catch {
    payload = {};
  }

  const mode = payload.mode === "preview" ? "preview" : "prepare-upload";
  const ttlSeconds = signedUrlTtlSeconds();

  if (mode === "preview") {
    const result = createItemImagePreview({
      itemId: id,
      ownerEmail,
      ttlSeconds,
    });

    if ("error" in result) {
      if (result.error === "NOT_FOUND") return errorResponse(404, "NOT_FOUND", "Item not found.");
      return errorResponse(403, "FORBIDDEN", "You do not have access to this item.");
    }

    if (!result.previewToken) {
      return NextResponse.json({
        ok: true as const,
        previewUrl: result.externalUrl,
        expiresInSec: null,
      });
    }

    return NextResponse.json({
      ok: true as const,
      previewUrl: buildPreviewUrl(id, result.previewToken),
      expiresInSec: ttlSeconds,
    });
  }

  const filename = (payload.filename || "image").trim();
  const mimeType = (payload.mimeType || "").trim().toLowerCase();
  const sizeBytes = Number(payload.sizeBytes);

  const fieldErrors: Record<string, string> = {};
  if (!mimeType) fieldErrors.mimeType = "Image MIME type is required.";
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    fieldErrors.sizeBytes = "Image size is required.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return errorResponse(422, "VALIDATION_ERROR", "Please fix the highlighted fields.", fieldErrors);
  }

  const result = prepareItemImageUpload({
    itemId: id,
    ownerEmail,
    filename: filename || "image",
    mimeType,
    sizeBytes,
    maxBytes: maxUploadBytes(),
    allowedMimeTypes: allowedMimeTypes(),
    ttlSeconds,
  });

  if ("error" in result) {
    return mapPrepareUploadError(result.error || "INVALID_SIZE");
  }

  return NextResponse.json({
    ok: true as const,
    uploadUrl: buildUploadUrl(id, result.uploadToken),
    expiresInSec: ttlSeconds,
    maxUploadMb: maxUploadBytes() / (1024 * 1024),
    allowedMimeTypes: allowedMimeTypes(),
  });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ownerEmail = ownerEmailFromHeader(request);
  if (!ownerEmail) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required to upload images.");
  }

  const { id } = await context.params;
  const uploadToken = request.nextUrl.searchParams.get("uploadToken") || "";

  if (!uploadToken) {
    return errorResponse(422, "VALIDATION_ERROR", "Upload token is required.", {
      uploadToken: "Upload token is required.",
    });
  }

  const contentTypeHeader = request.headers.get("content-type") || "";
  const mimeType = contentTypeHeader.split(";")[0]?.trim().toLowerCase();
  if (!mimeType) {
    return errorResponse(422, "VALIDATION_ERROR", "Content-Type is required.", {
      mimeType: "Content-Type is required.",
    });
  }

  const bytes = new Uint8Array(await request.arrayBuffer());

  const result = uploadItemImage({
    uploadToken,
    ownerEmail,
    mimeType,
    fileBytes: bytes,
    ttlSeconds: signedUrlTtlSeconds(),
  });

  if ("error" in result) {
    return mapUploadError(result.error || "INVALID_SIZE");
  }

  return NextResponse.json({
    ok: true as const,
    item: result.item,
    previewUrl: buildPreviewUrl(id, result.previewToken),
    expiresInSec: signedUrlTtlSeconds(),
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const previewToken = request.nextUrl.searchParams.get("previewToken") || "";

  if (!previewToken) {
    return errorResponse(422, "VALIDATION_ERROR", "Preview token is required.", {
      previewToken: "Preview token is required.",
    });
  }

  const resolved = resolveItemImagePreview({
    itemId: id,
    previewToken,
  });

  if ("error" in resolved) {
    if (resolved.error === "NOT_FOUND") {
      return errorResponse(404, "NOT_FOUND", "Image not found.");
    }
    return errorResponse(410, "INVALID_PREVIEW_TOKEN", "Preview URL expired. Refresh and try again.");
  }

  return new NextResponse(resolved.bytes, {
    status: 200,
    headers: {
      "content-type": resolved.contentType,
      "cache-control": "private, no-store, max-age=0",
      "content-length": String(resolved.bytes.byteLength),
    },
  });
}
