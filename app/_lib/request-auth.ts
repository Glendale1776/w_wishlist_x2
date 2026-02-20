import "server-only";

import type { NextRequest } from "next/server";

import { getSupabaseAdminClient } from "@/app/_lib/supabase-admin";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AuthFailureCode = "AUTH_REQUIRED" | "AUTH_INVALID" | "AUTH_MISMATCH";

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

export async function authenticateOwnerRequest(request: NextRequest): Promise<OwnerRequestAuthResult> {
  const token = getBearerToken(request);
  if (!token) {
    return { ok: false, code: "AUTH_REQUIRED" };
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.auth.getUser(token);
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
