# Fortis POS

NestJS backend: PostgreSQL (Drizzle ORM), Redis, RabbitMQ, Passport auth, NestJS Observe.


# Claude.md and AGENTS.md file update rule:
@updateRule.md

## Commands

```bash
npm run start:dev | start:prod
npm run db:generate | db:migrate | db:studio
npm run test | test:e2e | test:cov
```

## Available PostgreSQL function:
- @database_files/phase1_function.sql

## Structure

Feature modules in `src/<feature>/`: `.module.ts`, `.controller.ts`, `.service.ts`, `dto/`, `*.spec.ts`.
Infra modules: `database/` (Drizzle schema), `redis/`, `rabbitmq/`. E2E tests in `test/`.
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

Place unit tests in a `test/` folder inside the same directory as the code they cover. Each folder gets its own `test/`:
- `auth/` → tests in `auth/test/`
- `auth/guards/` → tests in `auth/guards/test/`


## Architecture Rules

- Business logic only in `.service.ts`; endpoints only in `.controller.ts` (parse input, call service, return).
- Config only via `ConfigModule`; no `process.env` elsewhere.
- No `any`; derive types from Drizzle schema and DTOs.
- Multi-step DB writes use transactions.
- Auth/security rules: see `src/auth/AGENTS.md`.

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
3. E2E tests (`test/*.e2e-spec.ts`): real app module + test DB; cover auth, validation, errors.
4. Run tests, confirm they fail for the right reason.
5. Implement until all pass.
6. Run `npm run test`, `npm run test:e2e`, type check, lint.

Don't edit a test just to make it pass unless the test is wrong; say so if so.

## Tasks

Decompose large tasks; parallelize independent subtasks; sequence dependent ones (schema → service → controller → e2e).

## Health

`GET /health/live` and `GET /health/ready` (PostgreSQL, Redis, RabbitMQ) must keep passing.

## Env

See `.env.example`: `DATABASE_URL`, `REDIS_URL`, `RABBITMQ_URL`, `OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`. Never commit secrets.

## Done When

Tests written first and passing; migrations generated if schema changed; health checks pass; no type/lint errors.
