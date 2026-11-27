<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Fortis Platform Web Client

Internal web app for Fortis platform staff: dashboard, business management and team management.

Uses the backend API at `/api/v1` (contract: `../backend/endpoints-details.md`). Mockups: `platform_dashboard.html`, `platform_businesses.html`, `platform_team.html`, `platform_sign_in.html`, `universal_loader.html` in `designs/`.

## Commands

```bash
npm run dev | build | start | lint
```

## Stack

- Next.js 16.4.6 App Router (`app/`), React 19.3, TypeScript (strict, no `any`).
- `next.config.ts` enables `cacheComponents` and `partialPrefetching`, so use the matching `next-cache-components-*`
  and `next-partial-prefetching-*` skills.
- Required libraries. Install each one the first time a feature needs it:
  - **Tailwind CSS 4** (via `@tailwindcss/turbopack`) for all styling. Theme tokens go in `app/globals.css`.
  - **shadcn/ui** for UI primitives. Add components with the shadcn CLI; don't hand-roll one shadcn already provides.
  - **react-icons** for icons.
  - **react-hook-form** (`useForm`) + **zod** schema + `zodResolver` from **@hookform/resolvers/zod** for every form.
  - **TanStack Query** (`@tanstack/react-query`) for client-side fetching, caching and mutations.

## Folder layout

All of these sit at the project root, next to `app/`:

```
app/                              routes; page.tsx only composes components
components/shared/                components used by 2+ pages
components/<page_name>/<Component>.tsx   components for one page
hooks/                            custom hooks (use<Name>.ts)
types/shared/                     cross-page types
types/<page_name>/*.ts            types for one page
api/                              typed functions that call the backend, grouped by resource
```

- Split every page into components under `components/<page_name>/`. Page files hold no large inline markup.
- Put reusable stateful or effect logic in a custom hook in `hooks/`, not inline in components.
- Derive types from zod schemas (`z.infer`) where possible.
- Every backend call goes through `api/`. Components never call `fetch` directly. `api/` (backend calls) is a
  different folder from `app/api/` (Next route handlers).

## Server Components first

- Components are Server Components by default. Add `"use client"` only to the smallest leaf that needs state,
  effects, browser APIs or event handlers, such as forms and interactive widgets.
- Server Components call the `api/` functions directly.
- Client components fetch through TanStack Query hooks (`useQuery` / `useMutation`) that wrap the same `api/`
  functions. Data prefetched on the server reaches the client through `HydrationBoundary`.
- Create one `QueryClientProvider` in a client `providers.tsx` and use it in the root layout.

## Rules

- Before using any Next.js API, read the guide in `node_modules/next/dist/docs/` (or use context7). This version
  differs from training data.
- Build the UI from the `designs/` mockups and keep the Fortis palette. Never ship the mockups' CDN Tailwind script.
- Verify behavior in the running app with `next-dev-loop` or playwright, not only with a type-check or lint.
