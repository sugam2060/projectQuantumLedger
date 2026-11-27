# Fortis POS — Monorepo

Point of Sale system: billing, inventory, staff management, plus sales-prediction analytics.

## Repo map

| Folder | What it is |
| --- | --- |
| `backend/` | NestJS API (`/api/v1`): PostgreSQL + Drizzle, Redis, RabbitMQ, Passport auth |
| `business_web_client/` | Next.js 16 web app for business owners and their staff |
| `platform_web_client/` | Next.js 16 web app for Fortis platform staff |
| `desktop_client/` | Electron Forge + Vite POS terminal app |
| `.github/workflows/` | CI (`CI-backend.yml`) |

## Per-project rules (AGENTS.md)

Each project keeps its own rules in its `AGENTS.md`. The project's `CLAUDE.md` stub imports it
(`@AGENTS.md`), so it loads automatically when you work inside that folder:

- Backend: [backend/AGENTS.md](backend/AGENTS.md)
- Business web client: [business_web_client/AGENTS.md](business_web_client/AGENTS.md)
- Platform web client: [platform_web_client/AGENTS.md](platform_web_client/AGENTS.md)
- Desktop client: [desktop_client/AGENTS.md](desktop_client/AGENTS.md)

Before editing a project, read its `AGENTS.md`. For work that crosses projects (for example an API
contract change that touches the backend and a client), read every affected `AGENTS.md`.
Edit rules in `AGENTS.md`, never in the `CLAUDE.md` stubs.

## Skills and plugins (mandatory)

Skills come from **user scope** (`~/.claude/skills/`), **project scope** (`.claude/skills/` at the repo root
or inside a project) and **enabled plugins**. All of them appear in the available-skills list.

1. Before any task, including clarifying questions or exploring, check that list and invoke every skill
   that applies. If a skill turns out not to fit, drop it.
2. Process skills come first and set the approach (superpowers: `brainstorming`, `writing-plans`,
   `test-driven-development`, `systematic-debugging`, `verification-before-completion`). Domain skills come
   next.
3. The map below is a starting point, not a whitelist. Use any other installed skill or plugin that fits,
   including ones added after this file was written.

| Project | Domain skills |
| --- | --- |
| backend | `nestjs-best-practices`, `nestjs-architecture-principles`, `nestjs-professional-software-engineering`, `nestjs-oop-design-patterns`, `nestjs-features-performance`, `nestjs-code-audit`, `nestjs-feature-audit`, `nestjs-git-commit-pr-message`, `drizzle-best-practices`, `postgres-best-practices`, `redis-core`, `redis-connections`, `redis-security`, `redis-clustering`, `api-design`, `javascript-testing-patterns`, `typescript-best-practices`, `jwt-decode` / `jwt-encode` / `jwt-validate` |
| business / platform web clients | `next-dev-loop`, `next-cache-components-adoption`, `next-cache-components-optimizer`, `next-partial-prefetching-adoption`, `next-partial-prefetching-optimizer`, `next-bundle-optimizer`, `frontend-design`, `typescript-best-practices`, `javascript-testing-patterns` |
| desktop client | `frontend-design`, `typescript-best-practices`, `javascript-testing-patterns` |

Plugins and MCP servers:

- **context7**: current docs for Next.js 16, React 19, Electron, NestJS, Drizzle, TanStack Query, shadcn/ui,
  zod and other libraries. Prefer it over memory for any library API.
- **playwright**: drive the running web apps to verify UI changes in a real browser.
- **code-review**, **security-review**, **simplify**: review a change before calling it done.
- **commit-commands**: commits, pushes and PRs (commit only when the user asks).
- **feature-dev**: explorer, architect and reviewer agents for larger features.
- **typescript-lsp**: code navigation and type info.
- **frontend-design**: any new or reshaped UI.

## Parallel execution

1. Break a complex task into subtasks and find the dependencies between them.
2. Run independent subtasks in parallel, with one agent per subtask and a clear responsibility for each.
3. Run dependent subtasks in order: schema → service → controller → e2e on the backend; types → api → hooks →
   components → page on the clients.
4. Merge and verify the results at the end.

```
Feature: business sign-in end to end
├── backend:              auth endpoint, DTOs, tests (see backend/AGENTS.md)
├── business_web_client:  types, api function, form components, page
└── desktop_client:       types, api function, sign-in screen
```

## Shared rules

- **Design source of truth.** Each client's `designs/*.html` mockups define the UI. Keep the Fortis palette:
  navy `#111D25`, forest `#496D59`, sage `#7FB596`, off-white `#F2F5F3`.
- **Secrets.** Never commit secrets, tokens or real customer data. Use placeholders.
- **TypeScript.** Strict typing everywhere, no `any`.
- **Keep instructions current.** When folder layout, commands, workflow rules or env vars change, update that
  project's `AGENTS.md` in the same change. Update this file too when the rule applies across projects.
