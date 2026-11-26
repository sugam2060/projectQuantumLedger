# Fortis POS

NestJS backend: PostgreSQL (Drizzle ORM), Redis, RabbitMQ, Passport auth, NestJS Observe.


# Claude.md and AGENTS.md file update rule:
Update this file (and `CLAUDE.md`) in the same change whenever folder layout, commands, workflow rules or env vars change.

## Commands

```bash
npm run start:dev | start:prod
npm run db:generate | db:migrate
npm run test | test:e2e | test:cov
npm run test:db:up && npm run test:db    # real Postgres + Redis (docker-compose.test.yml)
```

## SQL functions, roles and grants

Raw SQL that Drizzle cannot generate lives in `script/` and is applied by `script/migrate.ts`
around the Drizzle migrations (`npm run db:migrate`).
Migration works without SUPERUSER (managed Postgres): the migration user needs CREATEROLE and must own
the database. It creates `fortis_app` and sets its password (`FORTIS_APP_DB_PASSWORD`); a `fortis_app`
created by someone else needs `FORTIS_APP_ROLE_EXTERNALLY_MANAGED=true`. Migration refuses a `fortis_app`
with SUPERUSER, BYPASSRLS, REPLICATION or memberships in other roles.

## Structure

Feature folders sit directly under `src/` (no `src/modules/`). Each feature follows one template:

```
src/<feature>/
  <feature>.module.ts       wiring only
  <name>.controller.ts      thin HTTP layer (one per route group; several allowed)
  <name>.service.ts         business rules, throws HttpExceptions
  <name>.repository.ts      ALL SQL / Drizzle for that route group
  dto/                      one class per <action>.dto.ts + index.ts barrel
  types/                    one concept per <name>.type.ts + index.ts barrel
  decorators/ guards/ pipes/ strategies/ utils/   only when the feature owns them
  test/                     unit specs (*.spec.ts)
  index.ts                  public barrel; other features import only from it
  README.md                 endpoints, rules, gotchas, tests
```

Current features: `authentication/`, `audit-logs/`, `authorization/`, `businesses/`, `platform/`.
Cross-cutting and infra folders:

- `common/`: framework pieces used by 2+ features (`decorators/`, `guards/`, `types/`, `utils/`). No business rules, no SQL, no imports from feature folders.
- `config/`: one `registerAs` file per concern + `types/` + `env.validation.ts`. The only place that reads `process.env` (besides `script/`).
- `database/`: pool provider, `DatabaseService`, Drizzle schemas grouped by domain in `schemas/{auth,business,audit}/`, one table per file.
- `redis/`, `storage/`: infra modules (Redis client, object storage).
- `script/`: `migrate.ts` and raw SQL. `drizzle/`: migrations.

Global guards and the global pipe are registered once in `AppModule`, as an ordered and commented list.
Express-level setup lives in `src/app.setup.ts` (`configureApp`), which `main.ts` and e2e tests share.
Follow existing modules before introducing new patterns.

## Postman API Collection

- Keep `test/postman/fortis-api.postman_collection.json` synchronized with all
  routes declared by controllers. Whenever an endpoint is added, changed, or
  removed, update the collection in the same change.
- Add the exact HTTP method and `/api/v1` path, required headers, auth mode,
  body/query/path fields, and multipart file parts where applicable.
- Use collection variables for base URL, tokens, IDs, credentials, and file
  paths. Do not commit real passwords, access/refresh tokens, or customer data.
- Add response checks and token extraction where later requests depend on them.
  Document prerequisites for requests requiring an owner, platform user,
  terminal, role, database state, or local file.
- Keep `endpoints-details.md` and the Postman collection aligned. Validate the
  collection as JSON and confirm its route list covers every controller route
  before completing API work.

Tests:

- Unit specs go in one `test/` folder per feature or infra folder: `src/<feature>/test/*.spec.ts`
  (also `src/common/test/`, `src/config/test/`). Subfolders such as `guards/` do not get their own `test/`.
- E2E specs go in `test/<area>/*.e2e-spec.ts` (`authentication`, `authorization`, `businesses`, `platform`,
  `database`, `common`, `app`). Shared e2e helpers go in `test/<area>/helpers/`.
- Database tests (`*.db-spec.ts`, `npm run test:db`) run against the throwaway Postgres + Redis from
  `docker-compose.test.yml`. Global setup recreates the database and runs `script/migrate.ts`, so RLS,
  roles and SQL functions are the real ones. Use `test/database/helpers/` (pools as owner / fortis_app,
  `truncateAll`, factories) and `test/common/helpers/create-test-app.ts` for full-stack tests.
- `test/common/route-baseline.e2e-spec.ts` records every route (method + path + public flag). A route change
  must be intentional: regenerate with `UPDATE_ROUTE_BASELINE=1` and note it in the change.


## Architecture Rules

- Business logic only in `.service.ts`; endpoints only in `.controller.ts` (parse input, call service, return).
- Config only via `ConfigModule`; no `process.env` elsewhere.
- No `any`; derive types from Drizzle schema and DTOs.
- Multi-step DB writes use transactions.
- SQL and Drizzle calls only in `*.repository.ts`; services never touch `DatabaseService`.
- Auth/security rules: see `src/authentication/README.md`.
- Authorization: business routes with `:businessId` use `@RequiredPermission(Permission.X)`; platform routes use
  `@RequiredPlatformPermission`; own-account routes use `@SelfService()`. The route audit test enforces this.
  Details and how to add a permission: `src/authorization/README.md`.

## NestJS Building Blocks (use where needed; never inline this logic in services/controllers)

- **DTOs** (`class-validator`/`class-transformer`): every body, query, and param. Never accept raw objects or `any`.
- **Pipes**: global `ValidationPipe` (`whitelist: true`, `transform: true`); built-ins (`ParseUUIDPipe`, `ParseIntPipe`) for params; custom pipes for reusable transforms/validation.
- **Guards**: authentication, authorization, roles/permissions. Never check these inside handlers.
- **Interceptors**: cross-cutting logic around handlers: response mapping, logging, timing, caching, timeouts.
- **Middleware**: request-level concerns before routing: request IDs, logging, rate limiting, security headers.
- **Exception filters**: consistent error responses; throw Nest `HttpException` subclasses from services, not raw errors.
- **Custom decorators**: repeated metadata or param extraction (`@Public()`, `@Roles()`, `@CurrentUser()`). Don't read `req` directly in handlers.
- **Modules/providers**: constructor DI only; one module per feature; export only what others need.

Before writing a handler, check if any of these apply. If one does, use it and add tests for it.

## Workflow (TDD, mandatory order)

1. Service unit tests (`*.service.spec.ts`): mock deps; success, edge, error paths.
2. Controller unit tests (`*.controller.spec.ts`), plus guards/pipes/interceptors involved.
3. E2E tests (`test/<area>/*.e2e-spec.ts`): real app module + test DB; cover auth, validation, errors.
4. Run tests, confirm they fail for the right reason.
5. Implement until all pass.
6. Run `npm run test`, `npm run test:e2e`, type check, lint.

Don't edit a test just to make it pass unless the test is wrong; say so if so.

## Tasks

Decompose large tasks; parallelize independent subtasks; sequence dependent ones (schema → service → controller → e2e).

## Health

Health endpoints (`GET /health/live`, `GET /health/ready`) are planned but not implemented yet.

## Env

See `.env.example`: `DATABASE_URL`, `REDIS_URL`, `RABBITMQ_URL`, `OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`. Never commit secrets.

## Done When

Tests written first and passing; migrations generated if schema changed; route baseline intentional; no type/lint errors.
