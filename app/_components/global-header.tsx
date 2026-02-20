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
  const [isMenuOpen, setIsMenuOpen] = useState(false);

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

  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isMenuOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onWindowKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    }

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [isMenuOpen]);

  const isAuthenticated = Boolean(email);
  const isWishlistsActive = pathname.startsWith("/wishlists");
  const isActivityActive = pathname.startsWith("/me/activity");
  const shortAccountName = email ? email.split("@")[0] || email : "";

  async function handleSignOut() {
    await signOut();
    setEmail(null);
    setIsMenuOpen(false);
    router.push("/login");
    router.refresh();
  }

  function closeMenu() {
    setIsMenuOpen(false);
  }

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 w-full border-b border-sky-200 bg-[linear-gradient(90deg,#fef3c7_0%,#e0f2fe_48%,#fce7f3_100%)] shadow-sm backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link className="shrink-0" href="/">
          <Image alt="I WISH ..." className="h-10 w-auto sm:h-12" height={360} priority src="/logo-wordmark.svg" width={1200} />
        </Link>

        <button
          aria-controls="mobile-header-menu"
          aria-expanded={isMenuOpen}
          className="header-menu-button ml-auto sm:hidden"
          onClick={() => setIsMenuOpen((current) => !current)}
          type="button"
        >
          {isMenuOpen ? "Close" : "Menu"}
        </button>

        <nav
          className={
            isAuthenticated
              ? "ml-auto hidden flex-wrap items-center justify-end gap-x-6 gap-y-1 sm:flex sm:gap-x-10"
              : "ml-auto hidden flex-wrap items-center gap-2 sm:flex"
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
              <button
                className="header-nav-link header-nav-link--danger header-nav-link--logout"
                onClick={() => void handleSignOut()}
                title={email || undefined}
                type="button"
              >
                {`Log out ${shortAccountName}`}
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

      {isMenuOpen ? (
        <div className="fixed inset-0 z-40 sm:hidden">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-zinc-950/35 backdrop-blur-[2px]"
            onClick={closeMenu}
            type="button"
          />

          <nav
            className="absolute inset-x-4 top-[76px] rounded-2xl border border-sky-200 bg-white/95 p-5 shadow-xl"
            id="mobile-header-menu"
          >
            <div className="flex flex-col gap-4">
              {isAuthenticated ? (
                <>
                  <Link
                    className={`header-nav-link ${isWishlistsActive ? "header-nav-link--active" : ""}`}
                    href="/wishlists"
                    onClick={closeMenu}
                  >
                    My wishlists
                  </Link>
                  <Link
                    className={`header-nav-link ${isActivityActive ? "header-nav-link--active" : ""}`}
                    href="/me/activity"
                    onClick={closeMenu}
                  >
                    My activity
                  </Link>
                  <button
                    className="header-nav-link header-nav-link--danger header-nav-link--logout text-left"
                    onClick={() => void handleSignOut()}
                    title={email || undefined}
                    type="button"
                  >
                    {`Log out ${shortAccountName}`}
                  </button>
                </>
              ) : (
                <>
                  <Link className="btn-notch w-full uppercase tracking-[0.08em]" href="/login" onClick={closeMenu}>
                    Sign in
                  </Link>
                  <Link
                    className="btn-notch btn-notch--gradient w-full uppercase tracking-[0.08em]"
                    href="/signup"
                    onClick={closeMenu}
                  >
                    Create account
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      ) : null}
    </>
  );
}
