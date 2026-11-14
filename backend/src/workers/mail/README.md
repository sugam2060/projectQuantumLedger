# Mail worker

The worker is a separate NestJS application context. It shares the centralized
`RabbitMQService`; it does not create its own AMQP connection or expose HTTP
routes.

## Configuration and startup

Copy `.env.example` to `.env` and set the `MAIL_*` variables, along with the
existing `RABBITMQ_URL` and `REDIS_URL`, then run:

```sh
cd backend
npm run start:worker:dev
```

In production, build the backend and run `node dist/worker.main.js`. The worker
verifies SMTP and RabbitMQ connectivity before registering its consumer. It
stops accepting messages and waits for in-flight processing on shutdown.

## Publishing jobs

Inject `RabbitMQService` into a business service and publish a validated mail
job to the configured exchange and routing key:

```ts
import { randomUUID } from 'node:crypto';

const jobId = randomUUID();
await rabbit.publish(
  config.getOrThrow<string>('MAIL_EXCHANGE_NAME'),
  config.getOrThrow<string>('MAIL_ROUTING_KEY'),
  {
    id: jobId,
    to: 'recipient@example.com',
    subject: 'Your verification code',
    template: 'otp-verification',
    context: { code: '123456', expiresInMinutes: 10 },
    createdAt: new Date().toISOString(),
  },
  { messageId: jobId, correlationId: requestId },
);
```

Payment and other producers use the same publisher, changing only the job
content and approved template. Keep business-specific decisions in those
producers, not in the worker infrastructure.

## Templates and payloads

Only `otp-verification`, `user-invitation`, `redeem-code`, and `marketing-email`
are accepted. Handlebars HTML-escapes variables. Invitation and marketing
links must use HTTP or HTTPS. Attachments must contain base64 content; local
filesystem paths are never accepted. An optional `MAIL_MAX_ATTACHMENT_SIZE_BYTES`
limit is enforced before sending.

Required job fields are `id`, `to`, `subject`, `template`, `context`, and an
ISO-8601 `createdAt`. Optional fields include sender/reply-to, cc/bcc, plain
text, attachments, priority, and correlation ID.

## Retries, dead letters, and delivery guarantees

Transient failures are sent to durable TTL retry queues with capped exponential
delays. The original delivery is acknowledged only after RabbitMQ confirms the
retry or dead-letter publish. Retry exhaustion and permanent errors are routed
to the configured DLQ; the worker periodically reports its queue depth without
consuming or deleting DLQ messages. Failed republishing leaves the original
message unacknowledged and requeues it.

Redis locks and completion keys suppress concurrent and repeated job IDs.
Email delivery is still at-least-once, not exactly-once: a process or network
failure after SMTP acceptance but before the Redis completion write can cause
redelivery. Use stable unique job IDs and make downstream business operations
idempotent.

Import `MailModule` only in worker contexts that configure Redis and SMTP. The
HTTP API can continue using `UtilsModule` and `RabbitMQService` to publish jobs
without loading SMTP credentials or the mail consumer.
