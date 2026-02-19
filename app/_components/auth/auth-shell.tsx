import type { ReactNode } from "react";

type AuthShellProps = {
  title: string;
  subtitle: string;
  returnNotice?: string;
  children: ReactNode;
  footer: ReactNode;
};

export function AuthShell({ title, subtitle, returnNotice, children, footer }: AuthShellProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
          <p className="mt-2 text-sm text-zinc-600">{subtitle}</p>
          {returnNotice ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {returnNotice}
            </p>
          ) : null}
        </header>
        <div className="mt-6">{children}</div>
        <footer className="mt-6 border-t border-zinc-100 pt-4 text-sm text-zinc-700">{footer}</footer>
      </section>
    </main>
  );
}
