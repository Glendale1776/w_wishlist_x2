"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { AuthShell } from "@/app/_components/auth/auth-shell";
import { ErrorToast } from "@/app/_components/auth/error-toast";
import { mockRequestReset, validateEmail } from "@/app/_lib/auth-client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setToast(null);

    const nextEmailError = validateEmail(email);
    setEmailError(nextEmailError);
    if (nextEmailError) return;

    setIsSubmitting(true);
    const result = await mockRequestReset(email);
    setIsSubmitting(false);

    if (!result.ok) {
      setToast(result.message ?? "Unable to send reset email. Please retry.");
      return;
    }

    setIsSubmitted(true);
  }

  return (
    <>
      <ErrorToast message={toast} />
      <AuthShell
        title="Reset password"
        subtitle="Enter your email and we will send reset instructions if an account exists."
        footer={
          <p>
            Back to{" "}
            <Link className="font-medium text-zinc-900 underline underline-offset-2" href="/login">
              sign in
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
            {emailError ? <p className="mt-1 text-xs text-rose-700">{emailError}</p> : null}
          </div>

          {isSubmitted ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              If an account exists for this email, reset instructions were sent.
            </p>
          ) : null}

          <button
            className="w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Sending..." : "Send reset email"}
          </button>
        </form>
      </AuthShell>
    </>
  );
}
