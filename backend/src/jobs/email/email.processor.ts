import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MailJobPayload } from './email-job.payload';
import { PermanentMailError } from './email.errors';
import { EmailSenderService } from './mailer.service';
import { EMAIL_QUEUE, type MailJob } from './types';

/**
 * Email worker. Invalid payloads and permanent failures are marked unrecoverable
 * (BullMQ stops retrying them); anything else is retried with the queue's
 * exponential backoff. Failed jobs stay in Redis for inspection.
 */
@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly sender: EmailSenderService) {
    super();
  }

  async process(job: Job<unknown>): Promise<void> {
    const payload = plainToInstance(MailJobPayload, job.data);
    const errors = validateSync(payload, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length > 0) {
      this.logger.error(
        JSON.stringify({
          event: 'mail.job.invalid',
          jobId: job.id,
          fields: errors.map((error) => error.property),
        }),
      );
      throw new UnrecoverableError('Invalid email job payload');
    }

    try {
      await this.sender.send(payload as MailJob);
    } catch (error) {
      if (error instanceof PermanentMailError) {
        this.logger.error(
          JSON.stringify({
            event: 'mail.failed.permanent',
            jobId: job.id,
            code: error.code,
          }),
        );
        throw new UnrecoverableError(error.message);
      }
      this.logger.warn(
        JSON.stringify({
          event: 'mail.failed.retryable',
          jobId: job.id,
          attempt: job.attemptsMade + 1,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw error;
    }
  }
}
