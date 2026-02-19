import Link from "next/link";

const FEATURE_ROWS = [
  { label: "Auth", value: "Email + password + reset" },
  { label: "Owner flow", value: "Onboarding, wishlists, item editor" },
  { label: "Public flow", value: "Share links, reserve, contribute" },
  { label: "Ops", value: "Audit history and abuse controls" },
];

export default function Home() {
  return (
    <div className="min-h-screen">
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">
            Gift coordination without spoilers
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-zinc-700 sm:text-base">
            Owners share one link, friends reserve or pledge in real time, and identities stay hidden from the owner.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
              href="/signup"
            >
              Create account
            </Link>
            <Link
              className="inline-flex items-center rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-900"
              href="/login"
            >
              Sign in
            </Link>
          </div>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-600">Quick links</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Link className="rounded-lg border border-zinc-300 px-3 py-3 text-sm font-medium text-zinc-900" href="/wishlists">
                My wishlists
              </Link>
              <Link className="rounded-lg border border-zinc-300 px-3 py-3 text-sm font-medium text-zinc-900" href="/onboarding">
                Start onboarding
              </Link>
              <Link className="rounded-lg border border-zinc-300 px-3 py-3 text-sm font-medium text-zinc-900" href="/me/activity">
                My activity
              </Link>
              <Link className="rounded-lg border border-zinc-300 px-3 py-3 text-sm font-medium text-zinc-900" href="/admin/abuse">
                Admin abuse tools
              </Link>
            </div>
          </article>

          <article className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-600">Current capabilities</h2>
            <ul className="mt-4 space-y-2">
              {FEATURE_ROWS.map((row) => (
                <li className="rounded-lg border border-zinc-200 bg-white px-3 py-2" key={row.label}>
                  <p className="text-xs font-medium uppercase tracking-[0.1em] text-zinc-500">{row.label}</p>
                  <p className="mt-1 text-sm text-zinc-800">{row.value}</p>
                </li>
              ))}
            </ul>
          </article>
        </section>
      </main>
    </div>
  );
}
