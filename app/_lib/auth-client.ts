"use client";

import { getSupabaseBrowserClient } from "@/app/_lib/supabase-client";

export type AuthActionResult = {
  ok: boolean;
  message?: string;
  requiresEmailConfirmation?: boolean;
};

export type AuthFieldErrors = {
  email?: string;
  password?: string;
};

export type AuthIdentity = {
  email: string;
  userId: string;
  accessToken: string;
};

const RETURN_TO_KEY = "w_wishlist:return_to";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;

export function sanitizeReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (value.includes("://")) return null;
  return value;
}

export function persistReturnTo(value: string | null | undefined): void {
  const safeValue = sanitizeReturnTo(value);
  if (!safeValue || typeof window === "undefined") return;
  window.sessionStorage.setItem(RETURN_TO_KEY, safeValue);
}

export function readReturnTo(): string | null {
  if (typeof window === "undefined") return null;
  return sanitizeReturnTo(window.sessionStorage.getItem(RETURN_TO_KEY));
}

export function consumeReturnTo(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const stored = sanitizeReturnTo(window.sessionStorage.getItem(RETURN_TO_KEY));
  window.sessionStorage.removeItem(RETURN_TO_KEY);
  return stored ?? fallback;
}

export function validateEmail(email: string): string | undefined {
  if (!email.trim()) return "Email is required.";
  if (!EMAIL_REGEX.test(email.trim())) return "Enter a valid email address.";
  return undefined;
}

export function validatePassword(password: string): string | undefined {
  if (!password) return "Password is required.";
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return undefined;
}

export function validateAuthFields(email: string, password: string): AuthFieldErrors {
  return {
    email: validateEmail(email),
    password: validatePassword(password),
  };
}

function normalizeSupabaseErrorMessage(message: string | undefined, fallback: string): string {
  const normalized = (message || "").toLowerCase();
  if (!normalized) return fallback;
  if (normalized.includes("invalid login credentials")) return "Email or password is incorrect.";
  if (normalized.includes("email not confirmed")) return "Check your email to confirm your account before signing in.";
  if (normalized.includes("user already registered")) return "An account with this email already exists.";
  return fallback;
}

export async function isAuthenticated(): Promise<boolean> {
  const email = await getAuthenticatedEmail();
  return Boolean(email);
}

export async function getAuthenticatedIdentity(): Promise<AuthIdentity | null> {
  if (typeof window === "undefined") return null;

  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;

    const session = data.session;
    const email = session?.user?.email?.trim().toLowerCase() ?? "";
    const userId = session?.user?.id?.trim() ?? "";
    const accessToken = session?.access_token?.trim() ?? "";

    if (!EMAIL_REGEX.test(email) || !userId || !accessToken) return null;
    return {
      email,
      userId,
      accessToken,
    };
  } catch {
    return null;
  }
}

export async function getAuthenticatedEmail(): Promise<string | null> {
  const identity = await getAuthenticatedIdentity();
  return identity?.email ?? null;
}

export async function getAuthenticatedOwnerHeaders(): Promise<Record<string, string> | null> {
  const identity = await getAuthenticatedIdentity();
  if (!identity) return null;

  return {
    "x-owner-email": identity.email,
    authorization: `Bearer ${identity.accessToken}`,
  };
}

export async function signOut(): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
  } finally {
    window.sessionStorage.removeItem(RETURN_TO_KEY);
  }
}

export async function mockSignIn(email: string, password: string): Promise<AuthActionResult> {
  const fieldErrors = validateAuthFields(email, password);
  if (fieldErrors.email || fieldErrors.password) {
    return { ok: false, message: "Please fix the field errors and try again." };
  }

  try {
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      return {
        ok: false,
        message: normalizeSupabaseErrorMessage(error.message, "Unable to sign in right now. Please try again."),
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, message: "Unable to sign in right now. Please try again." };
  }
}

export async function mockSignUp(email: string, password: string): Promise<AuthActionResult> {
  const fieldErrors = validateAuthFields(email, password);
  if (fieldErrors.email || fieldErrors.password) {
    return { ok: false, message: "Please fix the field errors and try again." };
  }

  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      return {
        ok: false,
        message: normalizeSupabaseErrorMessage(error.message, "Unable to create account right now. Please try again."),
      };
    }

    if (!data.session) {
      return {
        ok: true,
        requiresEmailConfirmation: true,
        message: "Check your email to confirm your account before signing in.",
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, message: "Unable to create account right now. Please try again." };
  }
}

export async function mockRequestReset(email: string): Promise<AuthActionResult> {
  const emailError = validateEmail(email);
  if (emailError) {
    return { ok: false, message: "Enter a valid email address first." };
  }

  try {
    const supabase = getSupabaseBrowserClient();
    const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/login` : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo,
    });
    if (error) {
      return {
        ok: false,
        message: normalizeSupabaseErrorMessage(error.message, "Unable to send reset email right now. Please retry."),
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, message: "Unable to send reset email right now. Please retry." };
  }
}
