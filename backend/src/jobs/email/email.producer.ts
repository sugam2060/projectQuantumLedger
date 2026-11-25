import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { EMAIL_QUEUE, SEND_EMAIL_JOB, type MailJob } from './types';

/**
 * What features inject to send email. Enqueue after the database transaction
 * commits; the job id is the mail id, so enqueuing the same mail twice sends once.
 */
@Injectable()
export class EmailProducer {
  constructor(@InjectQueue(EMAIL_QUEUE) private readonly queue: Queue) {}

  async send(job: MailJob): Promise<void> {
    await this.queue.add(SEND_EMAIL_JOB, job, {
      jobId: job.id,
      priority: job.priority === undefined ? undefined : 10 - job.priority,
    });
  }
}
