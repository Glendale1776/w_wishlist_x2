import "server-only";

import type { NextRequest } from "next/server";

import { getSupabaseAdminClient } from "@/app/_lib/supabase-admin";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_AUTH_TIMEOUT_MS = 8_000;

type AuthFailureCode = "AUTH_REQUIRED" | "AUTH_INVALID" | "AUTH_MISMATCH" | "AUTH_TIMEOUT";

export type OwnerRequestAuthResult =
  | {
      ok: true;
      email: string;
      userId: string;
    }
  | {
      ok: false;
      code: AuthFailureCode;
    };

function normalizeHeaderEmail(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() || "";
  if (!normalized || !EMAIL_REGEX.test(normalized)) return null;
  return normalized;
}

function getBearerToken(request: NextRequest): string | null {
  const raw = request.headers.get("authorization") || "";
  const [scheme, token] = raw.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer") return null;
  const safeToken = token?.trim() || "";
  return safeToken || null;
}

class TimeoutError extends Error {
  constructor() {
    super("AUTH_TIMEOUT");
    this.name = "TimeoutError";
  }
}

function parseTimeoutMs(raw: string | undefined, fallback: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function authenticateOwnerRequest(request: NextRequest): Promise<OwnerRequestAuthResult> {
  const token = getBearerToken(request);
  if (!token) {
    return { ok: false, code: "AUTH_REQUIRED" };
  }

  const supabase = getSupabaseAdminClient();
  let data: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"];
  let error: Awaited<ReturnType<typeof supabase.auth.getUser>>["error"];
  try {
    const result = await withTimeout(
      supabase.auth.getUser(token),
      parseTimeoutMs(process.env.AUTH_TIMEOUT_MS, DEFAULT_AUTH_TIMEOUT_MS),
    );
    data = result.data;
    error = result.error;
  } catch (caught) {
    if (caught instanceof TimeoutError) {
      return { ok: false, code: "AUTH_TIMEOUT" };
    }
    return { ok: false, code: "AUTH_INVALID" };
  }

  if (error || !data.user) {
    return { ok: false, code: "AUTH_INVALID" };
  }

  const email = normalizeHeaderEmail(data.user.email || null);
  const userId = data.user.id?.trim() || "";
  if (!email || !userId) {
    return { ok: false, code: "AUTH_INVALID" };
  }

  const headerEmail = normalizeHeaderEmail(request.headers.get("x-owner-email"));
  if (headerEmail && headerEmail !== email) {
    return { ok: false, code: "AUTH_MISMATCH" };
  }

  return {
    ok: true,
    email,
    userId,
  };
}
