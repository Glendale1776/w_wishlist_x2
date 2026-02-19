"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { getAuthenticatedEmail, persistReturnTo } from "@/app/_lib/auth-client";
import { ApiErrorResponse, WishlistCreateResponse } from "@/app/_lib/wishlist-shell";

type OnboardingErrors = {
  title?: string;
  occasionNote?: string;
};

const SAMPLE_ITEMS = ["Portable projector", "Air fryer", "Weekend luggage"];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);

  const [title, setTitle] = useState("");
  const [occasionDate, setOccasionDate] = useState("");
  const [occasionNote, setOccasionNote] = useState("");
  const [useSampleItems, setUseSampleItems] = useState(false);

  const [errors, setErrors] = useState<OnboardingErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isCreated, setIsCreated] = useState(false);
  const [showSampleTip, setShowSampleTip] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const progressPercent = useMemo(() => (step / 2) * 100, [step]);

  function validateStepOne(): OnboardingErrors {
    if (!title.trim()) {
      return { title: "Wishlist title is required." };
    }
    return {};
  }

  function goToStepTwo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateStepOne();
    setErrors(nextErrors);
    if (nextErrors.title) return;
    setStep(2);
  }

  async function createWishlist() {
    const nextErrors = validateStepOne();
    setErrors(nextErrors);
    setApiError(null);
    if (nextErrors.title) {
      setStep(1);
      return;
    }

    const ownerEmail = await getAuthenticatedEmail();
    if (!ownerEmail) {
      persistReturnTo("/onboarding");
      router.push("/login?returnTo=/onboarding");
      return;
    }

    setIsSubmitting(true);
    let response: Response;
    try {
      response = await fetch("/api/wishlists", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-owner-email": ownerEmail,
        },
        body: JSON.stringify({
          title: title.trim(),
          occasionDate: occasionDate || null,
          occasionNote: occasionNote || null,
          currency: "USD",
        }),
      });
    } catch {
      setIsSubmitting(false);
      setApiError("Unable to create wishlist right now. Please retry.");
      return;
    }

    const payload = (await response.json()) as WishlistCreateResponse | ApiErrorResponse;
    setIsSubmitting(false);

    if (!response.ok || !payload.ok) {
      if (payload && !payload.ok && payload.error.fieldErrors) {
        setErrors((prev) => ({ ...prev, ...payload.error.fieldErrors }));
      }
      setApiError(payload && !payload.ok ? payload.error.message : "Unable to create wishlist right now.");
      return;
    }

    setIsCreated(true);
    setShowSampleTip(true);
    router.push("/wishlists?created=1");
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7">
        <header>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight">Create your first wishlist</h1>
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-600">Step {step} of 2</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full rounded-full bg-zinc-900 transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
          <p className="mt-3 text-sm text-zinc-600">
            Set up your list in under a minute, then share one public link with friends.
          </p>
        </header>

        {step === 1 ? (
          <form className="mt-6 space-y-4" onSubmit={goToStepTwo} noValidate>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-800" htmlFor="wishlist-title">
                Wishlist title
              </label>
              <input
                autoFocus
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                id="wishlist-title"
                maxLength={80}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Birthday 2026"
                value={title}
              />
              {errors.title ? <p className="mt-1 text-xs text-rose-700">{errors.title}</p> : null}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-800" htmlFor="occasion-date">
                Occasion date (optional)
              </label>
              <input
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                id="occasion-date"
                onChange={(event) => setOccasionDate(event.target.value)}
                type="date"
                value={occasionDate}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-800" htmlFor="occasion-note">
                Occasion note (optional)
              </label>
              <textarea
                className="min-h-24 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                id="occasion-note"
                maxLength={200}
                onChange={(event) => setOccasionNote(event.target.value)}
                placeholder="Anything friends should know?"
                value={occasionNote}
              />
              {errors.occasionNote ? <p className="mt-1 text-xs text-rose-700">{errors.occasionNote}</p> : null}
            </div>

            <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
              <button
                className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white"
                type="submit"
              >
                Continue
              </button>
              <button
                className="inline-flex items-center justify-center rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-800"
                onClick={() => router.push("/wishlists")}
                type="button"
              >
                Skip for now
              </button>
            </div>
          </form>
        ) : (
          <section className="mt-6 space-y-4">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <h2 className="text-sm font-semibold text-zinc-900">Wishlist preview</h2>
              <p className="mt-1 text-sm text-zinc-700">{title || "Untitled wishlist"}</p>
              <p className="mt-1 text-xs text-zinc-600">
                {occasionDate ? `Occasion date: ${occasionDate}` : "No occasion date set yet"}
              </p>
              <p className="mt-2 text-xs text-zinc-600">{occasionNote || "No occasion note added yet."}</p>
            </div>

            <label className="flex items-start gap-2 rounded-xl border border-zinc-200 p-4 text-sm text-zinc-800">
              <input
                checked={useSampleItems}
                className="mt-0.5"
                onChange={(event) => setUseSampleItems(event.target.checked)}
                type="checkbox"
              />
              <span>Try with sample items so you can edit and remove examples later.</span>
            </label>

            {useSampleItems ? (
              <ul className="rounded-xl border border-zinc-200 p-4 text-sm text-zinc-700">
                {SAMPLE_ITEMS.map((item) => (
                  <li className="py-1" key={item}>
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}

            {isCreated && useSampleItems && showSampleTip ? (
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
                <div className="flex items-start justify-between gap-3">
                  <p>Tip: These sample items are placeholders. You can remove them in the editor.</p>
                  <button
                    className="shrink-0 rounded border border-sky-300 px-2 py-1 text-xs font-medium"
                    onClick={() => setShowSampleTip(false)}
                    type="button"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ) : null}

            {isCreated ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                Wishlist shell created. Continue to My wishlists to manage it.
              </div>
            ) : null}

            {apiError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{apiError}</div>
            ) : null}

            <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
              <button
                className="inline-flex items-center justify-center rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-800"
                disabled={isSubmitting}
                onClick={() => setStep(1)}
                type="button"
              >
                Back
              </button>
              <button
                className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSubmitting}
                onClick={createWishlist}
                type="button"
              >
                {isSubmitting ? "Creating wishlist..." : "Create wishlist"}
              </button>
            </div>
          </section>
        )}
      </section>

      <p className="mt-4 text-center text-sm text-zinc-600">
        Prefer to continue later?{" "}
        <Link className="font-medium text-zinc-900 underline underline-offset-2" href="/wishlists">
          Open My wishlists
        </Link>
      </p>
    </main>
  );
}
