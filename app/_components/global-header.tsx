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
  const isWishlistsActive = pathname.startsWith("/wishlists");
  const isActivityActive = pathname.startsWith("/me/activity");

  async function handleSignOut() {
    await signOut();
    setEmail(null);
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="fixed inset-x-0 top-0 z-50 w-full border-b border-sky-200 bg-[linear-gradient(90deg,#fef3c7_0%,#e0f2fe_48%,#fce7f3_100%)] shadow-sm backdrop-blur">
      <div className="mx-auto flex w-full max-w-4xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link className="shrink-0" href="/">
          <Image alt="I WISH ..." className="h-10 w-auto sm:h-12" height={360} priority src="/logo-wordmark.svg" width={1200} />
        </Link>

        <nav
          className={
            isAuthenticated
              ? "ml-auto flex flex-wrap items-end justify-end gap-x-6 gap-y-1 sm:gap-x-10"
              : "ml-auto flex flex-wrap items-center gap-2"
          }
        >
          {isAuthenticated ? (
            <>
              <Link className={`header-nav-link ${isWishlistsActive ? "header-nav-link--active" : ""}`} href="/wishlists">
                My wishlists
              </Link>
              <Link className={`header-nav-link ${isActivityActive ? "header-nav-link--active" : ""}`} href="/me/activity">
                My activity
              </Link>
              <div className="flex flex-col items-end">
                <span className="header-nav-account-badge" title={email || undefined}>
                  {email}
                </span>
                <button className="header-nav-link header-nav-link--danger" onClick={() => void handleSignOut()} type="button">
                  Log out
                </button>
              </div>
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
