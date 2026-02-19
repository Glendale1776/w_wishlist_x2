"use client";

export type AuthActionResult = {
  ok: boolean;
  message?: string;
};

export type AuthFieldErrors = {
  email?: string;
  password?: string;
};

const RETURN_TO_KEY = "w_wishlist:return_to";
const AUTH_KEY = "w_wishlist:mock_auth";
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

export function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.localStorage.getItem(AUTH_KEY));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mockSignIn(email: string, password: string): Promise<AuthActionResult> {
  await sleep(450);
  const fieldErrors = validateAuthFields(email, password);
  if (fieldErrors.email || fieldErrors.password) {
    return { ok: false, message: "Please fix the field errors and try again." };
  }
  if (email.toLowerCase().endsWith("@error.test")) {
    return { ok: false, message: "Unable to sign in right now. Please try again." };
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem(AUTH_KEY, JSON.stringify({ email: email.trim().toLowerCase() }));
  }
  return { ok: true };
}

export async function mockSignUp(email: string, password: string): Promise<AuthActionResult> {
  await sleep(450);
  const fieldErrors = validateAuthFields(email, password);
  if (fieldErrors.email || fieldErrors.password) {
    return { ok: false, message: "Please fix the field errors and try again." };
  }
  if (email.toLowerCase().endsWith("@error.test")) {
    return { ok: false, message: "Unable to create account right now. Please try again." };
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem(AUTH_KEY, JSON.stringify({ email: email.trim().toLowerCase() }));
  }
  return { ok: true };
}

export async function mockRequestReset(email: string): Promise<AuthActionResult> {
  await sleep(450);
  const emailError = validateEmail(email);
  if (emailError) {
    return { ok: false, message: "Enter a valid email address first." };
  }
  if (email.toLowerCase().endsWith("@error.test")) {
    return { ok: false, message: "Unable to send reset email right now. Please retry." };
  }
  return { ok: true };
}
