status: done
id: S-01
topic: brief.md
title: Bootstrap Next.js 15 + TS + Tailwind foundation
Preconditions (P0s): none

Changes:
- routes/components/config: app shell only (`/` placeholder).
- API/schema: none.

Steps:
1. Initialize minimal Next.js app structure with TypeScript and App Router.
2. Add Tailwind CSS baseline wiring for global styles.
3. Add package scripts for `dev`, `build`, `start`, and `typecheck`.
4. Add placeholder home page that confirms runtime wiring.
5. Create `.env.example` with required baseline env names.
6. Add `.gitignore` entries for noise paths and Node artifacts.
7. Run `npm run typecheck` and `npm run build`.

Design focus:
- Mobile-first default viewport and readable typography baseline.
- Keep initial page clean and clearly scaffold-level.
- Global styles should be minimal and non-opinionated.

Tech focus:
- Next.js 15 + TypeScript app compiles without local hacks.
- Tailwind is wired in globals and build pipeline.
- Repo hygiene ignores `.DS_Store` and `docs/drift/`.
- Keep file count minimal for slice guardrails.

SQL?:
- none

Env?:
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL placeholder.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon key placeholder.
- `CANONICAL_HOST`: canonical host for share links.

Acceptance:
- `npm run typecheck` passes.
- `npm run build` passes.
- App boots with App Router and renders a placeholder page.
- Tailwind utility classes apply in the placeholder page.
- `.env.example` exists with baseline keys.
- `.gitignore` includes `.DS_Store`, `**/.DS_Store`, and `docs/drift/`.

Debts:
- Auth routes and API endpoints move to follow-up slices.
