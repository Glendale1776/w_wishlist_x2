"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { getAuthenticatedOwnerHeaders, persistReturnTo } from "@/app/_lib/auth-client";
import { ApiErrorResponse, WishlistCreateResponse } from "@/app/_lib/wishlist-shell";

type OnboardingErrors = {
  title?: string;
  occasionNote?: string;
};

const CREATE_WISHLIST_TIMEOUT_MS = 15_000;

export default function OnboardingPage() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [occasionDate, setOccasionDate] = useState("");
  const [occasionNote, setOccasionNote] = useState("");

  const [errors, setErrors] = useState<OnboardingErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validateStepOne(): OnboardingErrors {
    if (!title.trim()) {
      return { title: "Wishlist title is required." };
    }
    return {};
  }

  async function createWishlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateStepOne();
    setErrors(nextErrors);
    setApiError(null);
    if (nextErrors.title) return;

    const ownerHeaders = await getAuthenticatedOwnerHeaders();
    if (!ownerHeaders) {
      persistReturnTo("/onboarding");
      router.push("/login?returnTo=/onboarding");
      return;
    }

    setIsSubmitting(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), CREATE_WISHLIST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch("/api/wishlists", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...ownerHeaders,
        },
        signal: controller.signal,
        body: JSON.stringify({
          title: title.trim(),
          occasionDate: occasionDate || null,
          occasionNote: occasionNote || null,
          currency: "USD",
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setApiError("Creating wishlist timed out. Please retry.");
      } else {
        setApiError("Unable to create wishlist right now. Please retry.");
      }
      return;
    } finally {
      window.clearTimeout(timeoutId);
      setIsSubmitting(false);
    }

    let payload: WishlistCreateResponse | ApiErrorResponse | null = null;
    try {
      payload = (await response.json()) as WishlistCreateResponse | ApiErrorResponse;
    } catch {
      payload = null;
    }

    if (!response.ok || !payload || !payload.ok) {
      if (payload && !payload.ok && payload.error.fieldErrors) {
        setErrors((prev) => ({ ...prev, ...payload.error.fieldErrors }));
      }
      setApiError(payload && !payload.ok ? payload.error.message : "Unable to create wishlist right now.");
      return;
    }

    router.push(`/wishlists/${encodeURIComponent(payload.wishlist.id)}`);
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7">
        <header>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight">Create your first wishlist</h1>
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-600">Single step</span>
          </div>
          <p className="mt-3 text-sm text-zinc-600">
            Set up your list in under a minute, then share one public link with friends.
          </p>
        </header>

        <form className="mt-6 space-y-4" onSubmit={(event) => void createWishlist(event)} noValidate>
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

          {apiError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{apiError}</div>
          ) : null}

          <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <button
              className="inline-flex items-center justify-center rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-800"
              onClick={() => router.push("/wishlists")}
              type="button"
            >
              Back
            </button>
            <button
              className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Creating wishlist..." : "Create wishlist"}
            </button>
          </div>
        </form>
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
