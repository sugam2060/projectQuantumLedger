import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { Logger } from '@nestjs/common';
import type { RabbitMQService } from '../../../utils/rabbitmq.service';
import type { MailRuntimeConfig } from '../mail.config';
import { MailDlqMonitor } from './mail-dlq.monitor';

describe('MailDlqMonitor', () => {
  it('reports the DLQ depth without consuming its messages', async () => {
    const rabbit = {
      getQueueStats: jest.fn().mockResolvedValue({
        messageCount: 3,
        consumerCount: 0,
      }),
    };
    const warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const monitor = new MailDlqMonitor(
      rabbit as unknown as RabbitMQService,
      config,
    );

    await monitor.checkNow();

    expect(rabbit.getQueueStats).toHaveBeenCalledWith('mail.dead.queue');
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('"messageCount":3'),
    );
    warning.mockRestore();
  });
});

const config: MailRuntimeConfig = {
  smtpHost: 'smtp.example.test',
  smtpPort: 587,
  smtpSecure: false,
  smtpUsername: 'worker',
  smtpPassword: 'not-a-real-password',
  fromName: 'Example',
  fromEmail: 'no-reply@example.test',
  queueName: 'mail.jobs',
  exchangeName: 'mail.jobs',
  routingKey: 'mail.send',
  workerConcurrency: 2,
  prefetchCount: 4,
  maxRetries: 2,
  retryInitialDelayMs: 1000,
  retryMaxDelayMs: 5000,
  dlqEnabled: true,
  dlqExchange: 'mail.dead',
  dlqQueue: 'mail.dead.queue',
  dlqRoutingKey: 'mail.failed',
  dlqCheckIntervalMs: 10000,
  idempotencyTtlSeconds: 86400,
  idempotencyLockTtlSeconds: 120,
  maxAttachmentSizeBytes: 1024,
};
