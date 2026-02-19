"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getAuthenticatedEmail, signOut } from "@/app/_lib/auth-client";

export function GlobalHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function hydrateEmail() {
      const nextEmail = await getAuthenticatedEmail();
      if (!cancelled) setEmail(nextEmail);
    }

    void hydrateEmail();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const isAuthenticated = Boolean(email);

  async function handleSignOut() {
    await signOut();
    setEmail(null);
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="fixed inset-x-0 top-0 z-50 w-full border-b border-sky-200 bg-[linear-gradient(90deg,#fef3c7_0%,#e0f2fe_48%,#fce7f3_100%)] shadow-sm backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/">
          <Image alt="I WISH ..." className="h-10 w-auto sm:h-12" height={360} priority src="/logo-wordmark.svg" width={1200} />
        </Link>

        <nav className="flex flex-wrap items-center gap-2">
          {isAuthenticated ? (
            <>
              <Link className="btn-notch" href="/wishlists">
                My wishlists
              </Link>
              <Link className="btn-notch" href="/me/activity">
                My activity
              </Link>
              <button className="btn-notch btn-notch--rose" onClick={() => void handleSignOut()} type="button">
                Log out
              </button>
            </>
          ) : (
            <>
              <Link className="btn-notch uppercase tracking-[0.08em]" href="/login">
                Sign in
              </Link>
              <Link className="btn-notch btn-notch--gradient uppercase tracking-[0.08em]" href="/signup">
                Create account
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
