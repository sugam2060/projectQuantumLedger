<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

**hello**

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

Added Github action

## RabbitMQ messaging

`RabbitMQService` is provided and exported by `UtilsModule`. Configure either
`RABBITMQ_URL` or the host, port, username, password, and virtual-host
variables in `.env`. The service uses one reconnecting `AmqpConnection`, with
dedicated managed channels for consumers and publisher confirmations. If no
RabbitMQ connection settings are supplied, the app starts with messaging
disabled and RabbitMQ operations throw `ServiceUnavailableException`.

Declare infrastructure in a lifecycle provider before consuming:

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { RabbitMQService } from '../utils/rabbitmq.service';

@Injectable()
export class MailTopology implements OnModuleInit {
  constructor(private readonly rabbit: RabbitMQService) {}

  async onModuleInit(): Promise<void> {
    await this.rabbit.assertExchange('mail', 'topic', { durable: true });
    await this.rabbit.assertQueue('mail.send', {
      durable: true,
      deadLetterExchange: 'mail.dead',
      deadLetterRoutingKey: 'mail.failed',
      messageTtl: 60000,
    });
    await this.rabbit.bindQueue('mail.send', 'mail', 'email.send');
  }
}
```

Mail and payment modules inject the shared service; business processing stays
in the worker. A mail publisher can enqueue a typed job like this:

```typescript
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RabbitMQService } from '../utils/rabbitmq.service';

interface EmailJob {
  to: string;
  subject: string;
  template: string;
}

@Injectable()
export class MailService {
  constructor(private readonly rabbit: RabbitMQService) {}

  queueEmail(job: EmailJob): Promise<boolean> {
    return this.rabbit.publish('mail', 'email.send', job, {
      persistent: true,
      contentType: 'application/json',
      messageId: randomUUID(),
    });
  }
}
```

Register a mail worker in its provider lifecycle and let a successful handler
return normally; messages are acknowledged after processing. Failed handlers
are rejected without requeue by default so a configured dead-letter exchange
can receive them:

```typescript
import { Injectable } from '@nestjs/common';
import { RabbitMQService } from '../utils/rabbitmq.service';

@Injectable()
export class MailWorker implements OnModuleInit {
  constructor(private readonly rabbit: RabbitMQService) {}

  async onModuleInit(): Promise<void> {
    await this.rabbit.consume<EmailJob>(
      'mail-worker',
      'mail.send',
      async (job) => this.mailer.send(job),
    );
  }
}
```

Import the shared utility module from the mail feature module:

```typescript
import { Module } from '@nestjs/common';
import { UtilsModule } from '../utils/utils.module';

@Module({
  imports: [UtilsModule],
  providers: [MailTopology, MailService, MailWorker],
})
export class MailModule {}
```

A payment module uses the same API without sharing mail-specific code:

```typescript
import { Injectable } from '@nestjs/common';
import { RabbitMQService } from '../utils/rabbitmq.service';

interface PaymentJob {
  paymentId: string;
}

@Injectable()
export class PaymentService {
  constructor(private readonly rabbit: RabbitMQService) {}

  queuePayment(job: PaymentJob): Promise<boolean> {
    return this.rabbit.publish('payments', 'payment.process', job);
  }
}

import { Injectable, OnModuleInit } from '@nestjs/common';
import { RabbitMQService } from '../utils/rabbitmq.service';

@Injectable()
export class PaymentWorker implements OnModuleInit {
  constructor(private readonly rabbit: RabbitMQService) {}

  async onModuleInit(): Promise<void> {
    await this.rabbit.assertExchange('payments', 'topic');
    await this.rabbit.assertQueue('payments.process', {
      durable: true,
      deadLetterExchange: 'payments.dead',
    });
    await this.rabbit.bindQueue(
      'payments.process',
      'payments',
      'payment.process',
    );
    await this.rabbit.consume<PaymentJob>(
      'payment-worker',
      'payments.process',
      async (job) => this.processor.process(job),
      { prefetchCount: 5 },
    );
  }
}
```

The payment feature module follows the same dependency-injection pattern:

```typescript
import { Module } from '@nestjs/common';
import { UtilsModule } from '../utils/utils.module';

@Module({
  imports: [UtilsModule],
  providers: [PaymentService, PaymentWorker],
})
export class PaymentModule {}
```

The exported API includes exchange/queue assert, existence checks, deletion
and purge; queue and exchange bindings; typed JSON `publish` and `sendToQueue`;
`consume` and `cancelConsumer`; `serialize`/`deserialize`; and `isConnected`.
Consumer handlers receive the raw AMQP message and an ACK/NACK/reject context.
Use `context.nack(true)` for an explicit requeue; automatic application retry
policies are intentionally outside this infrastructure service.
