import { NextRequest, NextResponse } from "next/server";

import {
  createItemImagePreview,
  prepareItemImageUpload,
  uploadItemImage,
} from "@/app/_lib/item-store";
import { getSupabaseAdminClient, getSupabaseStorageBucket } from "@/app/_lib/supabase-admin";

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
  | "INTERNAL_ERROR";

type UploadUrlPayload = {
  mode?: "prepare-upload" | "preview";
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  imageIndex?: number;
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

async function createSignedPreviewUrl(path: string, ttlSeconds: number): Promise<string | null> {
  const supabase = getSupabaseAdminClient();
  const bucket = getSupabaseStorageBucket();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  if (error) return null;
  return data.signedUrl || null;
}

function mapPrepareUploadError(code: string) {
  if (code === "NOT_FOUND") return errorResponse(404, "NOT_FOUND", "Item not found.");
  if (code === "FORBIDDEN") return errorResponse(403, "FORBIDDEN", "You do not have access to this item.");
  if (code === "ARCHIVED") return errorResponse(409, "VALIDATION_ERROR", "Archived items cannot accept uploads.");
  if (code === "IMAGE_LIMIT_REACHED") {
    return errorResponse(422, "VALIDATION_ERROR", "This item already has the maximum of 10 images.", {
      imageFile: "This item already has the maximum of 10 images.",
    });
  }
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
  if (code === "IMAGE_LIMIT_REACHED") {
    return errorResponse(422, "VALIDATION_ERROR", "This item already has the maximum of 10 images.", {
      imageFile: "This item already has the maximum of 10 images.",
    });
  }
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
  if (code === "STORAGE_UPLOAD_FAILED") {
    return errorResponse(500, "INTERNAL_ERROR", "Unable to store image right now. Please retry.");
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
    const imageIndex = Number.isInteger(payload.imageIndex) && payload.imageIndex !== undefined && payload.imageIndex >= 0 ? payload.imageIndex : 0;
    const result = createItemImagePreview({
      itemId: id,
      ownerEmail,
      imageIndex,
    });

    if ("error" in result) {
      if (result.error === "NOT_FOUND") return errorResponse(404, "NOT_FOUND", "Item not found.");
      return errorResponse(403, "FORBIDDEN", "You do not have access to this item.");
    }

    if (result.externalUrl) {
      return NextResponse.json({
        ok: true as const,
        previewUrl: result.externalUrl,
        expiresInSec: null,
      });
    }

    if (result.storagePath) {
      const signedPreviewUrl = await createSignedPreviewUrl(result.storagePath, ttlSeconds);
      if (!signedPreviewUrl) {
        return errorResponse(500, "INTERNAL_ERROR", "Unable to create image preview right now.");
      }

      return NextResponse.json({
        ok: true as const,
        previewUrl: signedPreviewUrl,
        expiresInSec: ttlSeconds,
      });
    }

    return NextResponse.json({
      ok: true as const,
      previewUrl: null,
      expiresInSec: null,
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

export async function PUT(request: NextRequest) {
  const ownerEmail = ownerEmailFromHeader(request);
  if (!ownerEmail) {
    return errorResponse(401, "AUTH_REQUIRED", "Sign in is required to upload images.");
  }

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

  const result = await uploadItemImage({
    uploadToken,
    ownerEmail,
    mimeType,
    fileBytes: bytes,
  });

  if ("error" in result) {
    return mapUploadError(result.error || "INVALID_SIZE");
  }

  const ttlSeconds = signedUrlTtlSeconds();
  const previewUrl = await createSignedPreviewUrl(result.storagePath, ttlSeconds);

  return NextResponse.json({
    ok: true as const,
    item: result.item,
    previewUrl,
    expiresInSec: previewUrl ? ttlSeconds : null,
  });
}
