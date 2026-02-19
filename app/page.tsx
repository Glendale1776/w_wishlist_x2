"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { getAuthenticatedEmail } from "@/app/_lib/auth-client";

const CELEBRATION_NOTES = [
  "Picture your favorite surprise waiting for you, chosen with love by people who know you best.",
  "Let family and friends quietly team up on the gift you have always dreamed about.",
  "Feel the joy of being celebrated while every little detail stays beautifully effortless.",
];

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthResolved, setIsAuthResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function hydrateAuth() {
      const email = await getAuthenticatedEmail();
      if (cancelled) return;
      setIsAuthenticated(Boolean(email));
      setIsAuthResolved(true);
    }

    void hydrateAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen">
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <section className="relative overflow-hidden px-1 pb-4 pt-2 sm:pb-6">
          <div className="pointer-events-none absolute -left-16 -top-10 h-52 w-52 rounded-full bg-sky-200/55 blur-3xl" />
          <div className="pointer-events-none absolute -right-12 top-16 h-44 w-44 rounded-full bg-emerald-200/45 blur-3xl" />

          <h1 className="max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Celebrate your moments with gifts chosen from the heart
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-zinc-700 sm:text-lg">
            Your birthday, anniversary, or special day feels even brighter when the people you love can secretly prepare
            something you truly wish for. Every message, every contribution, every kind choice becomes part of one
            unforgettable celebration.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            {isAuthResolved ? (
              isAuthenticated ? (
                <>
                  <Link className="btn-notch btn-notch--ink" href="/wishlists">
                    Open my wishlist
                  </Link>
                  <Link className="btn-notch" href="/onboarding">
                    Start a new celebration
                  </Link>
                </>
              ) : (
                <>
                  <Link className="btn-notch btn-notch--ink" href="/signup">
                    Create account
                  </Link>
                  <Link className="btn-notch" href="/login">
                    Sign in
                  </Link>
                </>
              )
            ) : (
              <Link className="btn-notch btn-notch--ink" href="/wishlists">
                Open my wishlist
              </Link>
            )}
          </div>
        </section>

        <section className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <article className="px-1">
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-zinc-700">Your Celebration Flow</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Link className="btn-notch w-full justify-center" href="/wishlists">
                My wishlists
              </Link>
              <Link className="btn-notch w-full justify-center" href="/onboarding">
                Start onboarding
              </Link>
              <Link className="btn-notch w-full justify-center" href="/me/activity">
                My activity
              </Link>
              <Link className="btn-notch w-full justify-center" href="/admin/abuse">
                Admin tools
              </Link>
            </div>
          </article>

          <article className="px-1">
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-zinc-700">Why It Feels Special</h2>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-zinc-700 sm:text-base">
              {CELEBRATION_NOTES.map((note) => (
                <li className="relative pl-6" key={note}>
                  <span className="absolute left-0 top-2 h-2.5 w-2.5 rounded-full bg-sky-500" />
                  {note}
                </li>
              ))}
            </ul>
          </article>
        </section>
      </main>
    </div>
  );
}
