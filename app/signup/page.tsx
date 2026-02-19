"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";

import { AuthShell } from "@/app/_components/auth/auth-shell";
import { ErrorToast } from "@/app/_components/auth/error-toast";
import {
  consumeReturnTo,
  isAuthenticated,
  mockSignUp,
  persistReturnTo,
  sanitizeReturnTo,
  validateAuthFields,
} from "@/app/_lib/auth-client";

function SignupContent() {
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
    if (isAuthenticated()) router.replace("/wishlists");
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setToast(null);

    const nextErrors = validateAuthFields(email, password);
    setErrors(nextErrors);
    if (nextErrors.email || nextErrors.password) return;

    setIsSubmitting(true);
    const result = await mockSignUp(email, password);
    setIsSubmitting(false);

    if (!result.ok) {
      setToast(result.message ?? "Unable to create your account. Please retry.");
      return;
    }

    const destination = consumeReturnTo("/onboarding");
    router.replace(destination);
  }

  return (
    <>
      <ErrorToast message={toast} />
      <AuthShell
        title="Create account"
        subtitle="Create an account to manage wishlists and gift activity."
        returnNotice={returnTo ? "You will return to your item after sign up." : undefined}
        footer={
          <p>
            Already have an account?{" "}
            <Link className="font-medium text-zinc-900 underline underline-offset-2" href={`/login${returnToQuery}`}>
              Sign in
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
            <label className="mb-1 block text-sm font-medium text-zinc-800" htmlFor="password">
              Password
            </label>
            <input
              autoComplete="new-password"
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
            {isSubmitting ? "Creating account..." : "Create account"}
          </button>
        </form>
      </AuthShell>
    </>
  );
}

function SignupFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm sm:p-8">
        Loading sign up...
      </div>
    </main>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<SignupFallback />}>
      <SignupContent />
    </Suspense>
  );
}
