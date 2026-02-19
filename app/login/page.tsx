"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";

import { AuthShell } from "@/app/_components/auth/auth-shell";
import { ErrorToast } from "@/app/_components/auth/error-toast";
import {
  consumeReturnTo,
  isAuthenticated,
  mockSignIn,
  persistReturnTo,
  sanitizeReturnTo,
  validateAuthFields,
} from "@/app/_lib/auth-client";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const returnTo = useMemo(() => sanitizeReturnTo(searchParams.get("returnTo")), [searchParams]);
  const returnToQuery = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [toast, setToast] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (returnTo) persistReturnTo(returnTo);
  }, [returnTo]);

  useEffect(() => {
    let cancelled = false;

    async function redirectIfAuthenticated() {
      const authenticated = await isAuthenticated();
      if (!cancelled && authenticated) {
        router.replace("/wishlists");
      }
    }

    void redirectIfAuthenticated();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setToast(null);

    const nextErrors = validateAuthFields(email, password);
    setErrors(nextErrors);
    if (nextErrors.email || nextErrors.password) return;

    setIsSubmitting(true);
    const result = await mockSignIn(email, password);
    setIsSubmitting(false);

    if (!result.ok) {
      setToast(result.message ?? "Unable to sign in. Please retry.");
      return;
    }

    const destination = consumeReturnTo("/wishlists");
    router.replace(destination);
  }

  return (
    <>
      <ErrorToast message={toast} />
      <AuthShell
        title="Sign in"
        subtitle="Sign in to reserve or contribute and continue where you left off."
        returnNotice={returnTo ? "You will return to your item after sign in." : undefined}
        footer={
          <p>
            Need an account?{" "}
            <Link className="font-medium text-zinc-900 underline underline-offset-2" href={`/signup${returnToQuery}`}>
              Create one
            </Link>
          </p>
        }
      >
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-800" htmlFor="email">
              Email
            </label>
            <input
              autoComplete="email"
              autoFocus
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none ring-0 focus:border-zinc-500"
              id="email"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
            />
            {errors.email ? <p className="mt-1 text-xs text-rose-700">{errors.email}</p> : null}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-sm font-medium text-zinc-800" htmlFor="password">
                Password
              </label>
              <Link className="text-xs text-zinc-700 underline underline-offset-2" href="/forgot-password">
                Forgot password?
              </Link>
            </div>
            <input
              autoComplete="current-password"
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none ring-0 focus:border-zinc-500"
              id="password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
            {errors.password ? <p className="mt-1 text-xs text-rose-700">{errors.password}</p> : null}
          </div>

          <button
            className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </AuthShell>
    </>
  );
}

function LoginFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm sm:p-8">
        Loading sign in...
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginContent />
    </Suspense>
  );
}
