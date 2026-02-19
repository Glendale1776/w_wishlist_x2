status: done
id: S-02
topic: brief.md
title: Auth routes and return-to-item flow shell
Preconditions (P0s): none

Changes:
- routes/components/config: add `/signup`, `/login`, `/forgot-password` route UIs and route guards.
- API/schema: none.

Steps:
1. Add auth route pages with shared mobile-first form layout.
2. Implement email/password field validation and disabled submit states.
3. Add mode switch links between sign up and sign in.
4. Add forgot-password request form and neutral success state.
5. Persist `returnTo` destination in query or session storage.
6. Restore destination after successful sign-in.
7. Add lightweight "returning to item" notice on auth pages.
8. Add loading and server-error toast handling for auth actions.

Design focus:
- Centered auth card with clear hierarchy on mobile.
- Inline validation messaging under each field.
- Return-to-item notice remains visible but unobtrusive.
- Submit buttons communicate busy state clearly.

Tech focus:
- Typed auth action responses and error mapping.
- `returnTo` must be sanitized to internal paths only.
- Auth routes should not depend on wishlist APIs.
- Keep implementation isolated to route and auth client layer.

SQL?:
- none

Env?:
- `NEXT_PUBLIC_SUPABASE_URL`: browser Supabase auth endpoint.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: browser Supabase anon key.

Acceptance:
- `/signup`, `/login`, `/forgot-password` render and submit states work.
- Invalid email/password inputs show inline field errors.
- Sign-in restores a valid saved `returnTo` destination.
- External/unsafe `returnTo` values are rejected to safe fallback.
- Forgot-password flow shows neutral confirmation response.

Debts:
- Social login remains out of scope for V1.
