import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { EmailWorkerModule } from './email-worker.module';
import { EmailProducer } from './email.producer';
import { EMAIL_JOB_ATTEMPTS, EMAIL_JOB_BACKOFF_MS, EMAIL_QUEUE } from './types';

/**
 * The `email` queue. Features import this module and inject `EmailProducer`. The
 * worker side is registered only when JOBS_WORKERS_ENABLED is not "false", so an
 * instance can enqueue without consuming (and tests run without SMTP).
 */
@Module({
  imports: [
    BullModule.registerQueue({
      name: EMAIL_QUEUE,
      defaultJobOptions: {
        attempts: EMAIL_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: EMAIL_JOB_BACKOFF_MS },
      },
    }),
    ConditionalModule.registerWhen(
      EmailWorkerModule,
      (env) => env.JOBS_WORKERS_ENABLED?.toLowerCase() !== 'false',
    ),
  ],
  providers: [EmailProducer],
  exports: [EmailProducer],
})
export class EmailModule {}
