<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Database, cache, and messaging

The backend uses PostgreSQL through Drizzle ORM, Redis through ioredis, and
RabbitMQ through amqplib. The supplied `.env.example` connection URLs are copied
into `.env` for local development. Run migrations and start the backend from
this directory:

```bash
npm run db:generate
npm run db:migrate
npm run start:dev
```

`docker-compose.yml` is available when you want to run the infrastructure
locally; in that case, set the three connection URLs in `.env` to the local
addresses and credentials from that Compose file. Named volumes retain local
service data. RabbitMQ management UI is available at http://localhost:15672
(user/password: `quantum` / `quantum`). `DatabaseModule`, `RedisService`, and
`RabbitMQService` are global Nest providers. Inject `DatabaseService` and use
its shared `db` client for Drizzle queries; `DATABASE` remains available as a
direct Drizzle client token. Inject `RedisService` for Redis commands and
`RabbitMQService` to publish or consume JSON messages from durable queues.
Define each table in its own file under `src/database/schema/` and export it
from `src/database/schema.ts` before generating migrations. PostgreSQL pool
defaults are 20 connections per backend process,
30 seconds idle timeout, and 5 seconds connection timeout; tune with
`DB_POOL_MAX`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_POOL_CONNECTION_TIMEOUT_MS`, and
`DB_POOL_MAX_USES` while keeping the total across replicas within the database
connection limit.

The initial tenant/access schema includes businesses, branches, users,
memberships, invitations, endpoint permissions, role templates, and role
assignments. A branch-scoped template can be reused by assigning it to
different members with different `branch_id` values in `membership_roles`; a
global template uses a null `branch_id` and applies to all business branches.
invitations carry the selected template and optional branch scope so those
assignments can be created when the invite is accepted. This is schema support;
permission codes still need to be seeded and invitation endpoints implemented.
The auth module provides reusable role and permission guards; apply them on
protected feature routes.

Local Compose credentials are for development only. Set strong credentials and
the matching `DATABASE_URL`, `REDIS_URL`, and `RABBITMQ_URL` in deployed
environments.

## Authentication

Authentication is available for existing active users with a bcrypt password
hash. Set `JWT_SECRET` to at least 32 random bytes (generate one with the
command shown in `.env.example`). `POST /api/v1/auth/login` requires
`X-Client-Type: desktop`, `mobile`, or `web`; the JSON body accepts `email`,
`password`, and optional `deviceLabel`. Public registration is intentionally
not enabled.

Desktop and mobile clients receive an HS256 bearer access JWT (15 minutes),
opaque base64url refresh token (48-hour Redis session), and the user and
membership summary in the response body. Only a SHA-256 hash of the refresh
secret is stored in Redis. `POST /api/v1/auth/refresh` rotates the refresh
token and issues a new access token; send the refresh token in the request
body for desktop/mobile clients. Reuse of a rotated token is rejected.
`POST /api/v1/auth/logout` revokes the managed session. Protected routes use
`Authorization: Bearer <access-token>`.

Web clients receive `HttpOnly`, `SameSite=Strict` access and refresh cookies
instead of token values in the response body. Cookies are `Secure` in
production; the access cookie is scoped to `/api/v1` and the refresh cookie to
`/api/v1/auth/refresh`. Use a same-site frontend/API deployment (or a same-origin
proxy). If using separate origins, configure explicit credentialed CORS and
review the cookie/CSRF policy for those origins.

Login is rate-limited to 10 attempts per IP per 60 seconds using shared Redis
state and returns `429` with `Retry-After` when exceeded. Configure the
deployment's trusted proxy addresses deliberately so Express reports the
client IP correctly; forwarded headers are not trusted automatically.

JWTs include role and permission claims scoped to each business and branch.
Use `@UseGuards(JwtAuthGuard, AccessControlGuard)` with `@RequireRoles(...)`
and/or `@RequirePermissions(...)` on protected handlers. The guard checks the
business and optional branch from route parameters or `X-Business-ID` and
`X-Branch-ID` headers. Branch-scoped grants do not authorize a different
branch or an unscoped business-wide request. Permission changes take effect
when the access token expires or is refreshed.

The login lookup runs in a transaction-local platform-access context so RLS
can return the user's active memberships and grants. The auth service sets this
context only inside short-lived read transactions; never derive it from request
input. Apply the generated Drizzle migration before deploying this version.

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

This project is already instrumented. To connect it, run this and approve the code it prints at [observe.nestjs.com/link](https://observe.nestjs.com/link) - signing up for free if you have no account:

```bash
$ npx @nestjs/observe link
```

It writes the app key and secret into `.env` and makes every `nest start` script (`start`, `start:dev`, `start:debug`) load it. In production, set `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` in the environment instead.

Or do it by hand: create an application and an API key at [observe.nestjs.com](https://observe.nestjs.com), and set the pair as `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` in the environment the app runs in.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
