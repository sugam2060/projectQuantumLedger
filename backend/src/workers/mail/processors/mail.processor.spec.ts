import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import type { RabbitMQMessageContext } from '../../../utils/rabbitmq.service';
import type { RabbitMQService } from '../../../utils/rabbitmq.service';
import type { RedisService } from '../../../redis/redis.service';
import { MAIL_RETRY_COUNT_HEADER } from '../mail.constants';
import type { MailRuntimeConfig } from '../mail.config';
import { MailService } from '../mail.service';
import { PermanentMailError, type MailJob } from '../mail.types';
import {
  MailProcessor,
  isRetryableMailFailure,
  validateMailJob,
} from './mail.processor';

describe('MailProcessor', () => {
  let rabbit: {
    waitForConnection: jest.Mock;
    assertExchange: jest.Mock;
    assertQueue: jest.Mock;
    bindQueue: jest.Mock;
    consume: jest.Mock;
    cancelConsumer: jest.Mock;
    publish: jest.Mock;
    getQueueStats: jest.Mock;
  };
  let mailer: { send: jest.Mock };
  let redis: {
    exists: jest.Mock;
    set: jest.Mock;
    setIfAbsent: jest.Mock;
    compareAndDelete: jest.Mock;
  };
  let processor: MailProcessor;
  let consumerHandler:
    | ((payload: unknown, context: RabbitMQMessageContext) => Promise<void>)
    | undefined;

  beforeEach(() => {
    consumerHandler = undefined;
    rabbit = {
      waitForConnection: jest.fn().mockResolvedValue(undefined),
      assertExchange: jest.fn().mockResolvedValue(undefined),
      assertQueue: jest.fn().mockResolvedValue(undefined),
      bindQueue: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn(
        async (
          _consumerId: string,
          _queueName: string,
          handler: (
            payload: unknown,
            context: RabbitMQMessageContext,
          ) => Promise<void>,
        ) => {
          consumerHandler = handler;
          return 'consumer-tag';
        },
      ),
      cancelConsumer: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn().mockResolvedValue(true),
      getQueueStats: jest.fn().mockResolvedValue({
        messageCount: 0,
        consumerCount: 0,
      }),
    };
    mailer = { send: jest.fn().mockResolvedValue(undefined) };
    redis = {
      exists: jest.fn().mockResolvedValue(false),
      set: jest.fn().mockResolvedValue(undefined),
      setIfAbsent: jest.fn().mockResolvedValue(true),
      compareAndDelete: jest.fn().mockResolvedValue(true),
    };
    processor = new MailProcessor(
      rabbit as unknown as RabbitMQService,
      mailer as unknown as MailService,
      redis as unknown as RedisService,
      config,
    );
  });

  it('waits for RabbitMQ, declares durable topology, and registers one consumer', async () => {
    await processor.onModuleInit();

    expect(rabbit.waitForConnection).toHaveBeenCalledTimes(1);
    expect(rabbit.assertExchange).toHaveBeenCalledWith('mail.jobs', 'topic', {
      durable: true,
    });
    expect(rabbit.assertExchange).toHaveBeenCalledWith('mail.dead', 'direct', {
      durable: true,
    });
    expect(rabbit.assertQueue).toHaveBeenCalledWith('mail.jobs', {
      durable: true,
      deadLetterExchange: 'mail.dead',
      deadLetterRoutingKey: 'mail.failed',
    });
    expect(rabbit.assertQueue).toHaveBeenCalledWith('mail.jobs.retry.1', {
      durable: true,
      messageTtl: 1000,
      deadLetterExchange: 'mail.jobs',
      deadLetterRoutingKey: 'mail.send',
    });
    expect(rabbit.consume).toHaveBeenCalledTimes(1);
    expect(consumerHandler).toBeDefined();
  });

  it('delivers valid jobs and records completion before releasing the lock', async () => {
    await processor.onModuleInit();
    const context = messageContext();

    await consumerHandler?.(validJob(), context);

    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'job-1',
        to: 'user@example.test',
        template: 'otp-verification',
      }),
    );
    expect(redis.set).toHaveBeenCalledWith(
      'mail:sent:job-1',
      'sent',
      config.idempotencyTtlSeconds,
    );
    expect(redis.compareAndDelete).toHaveBeenCalledWith(
      'mail:lock:job-1',
      expect.any(String),
    );
    expect(jest.mocked(context.nack)).not.toHaveBeenCalled();
  });

  it('schedules a transient failure and acknowledges only after confirmed republish', async () => {
    await processor.onModuleInit();
    mailer.send.mockRejectedValue(new Error('SMTP temporarily unavailable'));
    const context = messageContext();

    await consumerHandler?.(validJob(), context);

    expect(rabbit.publish).toHaveBeenCalledWith(
      '',
      'mail.jobs.retry.1',
      context.message.content,
      expect.objectContaining({
        persistent: true,
        headers: { [MAIL_RETRY_COUNT_HEADER]: 1 },
      }),
    );
    expect(jest.mocked(context.ack)).toHaveBeenCalledTimes(1);
    expect(jest.mocked(context.nack)).not.toHaveBeenCalled();
  });

  it('requeues the original message when retry publication is not confirmed', async () => {
    await processor.onModuleInit();
    mailer.send.mockRejectedValue(new Error('temporary provider error'));
    rabbit.publish.mockResolvedValue(false);
    const context = messageContext();

    await consumerHandler?.(validJob(), context);

    expect(jest.mocked(context.nack)).toHaveBeenCalledWith(true);
    expect(jest.mocked(context.ack)).not.toHaveBeenCalled();
  });

  it('routes permanent failures to the DLQ and acknowledges after confirmation', async () => {
    await processor.onModuleInit();
    mailer.send.mockRejectedValue(
      new PermanentMailError('invalid recipient', 'INVALID_RECIPIENT'),
    );
    const context = messageContext();

    await consumerHandler?.(validJob(), context);

    expect(rabbit.publish).toHaveBeenCalledWith(
      'mail.dead',
      'mail.failed',
      context.message.content,
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-mail-failure-code': 'INVALID_RECIPIENT',
        }),
      }),
    );
    expect(jest.mocked(context.ack)).toHaveBeenCalledTimes(1);
  });

  it('dead-letters transient failures after the configured retry limit', async () => {
    await processor.onModuleInit();
    mailer.send.mockRejectedValue(new Error('SMTP temporarily unavailable'));
    const context = messageContext({ [MAIL_RETRY_COUNT_HEADER]: 2 });

    await consumerHandler?.(validJob(), context);

    expect(rabbit.publish).toHaveBeenCalledWith(
      'mail.dead',
      'mail.failed',
      context.message.content,
      expect.objectContaining({
        headers: expect.objectContaining({
          [MAIL_RETRY_COUNT_HEADER]: 2,
          'x-mail-failure-code': 'TRANSIENT_FAILURE',
        }),
      }),
    );
    expect(jest.mocked(context.ack)).toHaveBeenCalledTimes(1);
  });

  it('skips a previously completed job without sending it again', async () => {
    await processor.onModuleInit();
    redis.exists.mockImplementation(
      async (key: string) => key === 'mail:sent:job-1',
    );
    const context = messageContext();

    await consumerHandler?.(validJob(), context);

    expect(mailer.send).not.toHaveBeenCalled();
    expect(redis.setIfAbsent).not.toHaveBeenCalled();
    expect(jest.mocked(context.nack)).not.toHaveBeenCalled();
  });

  it('cancels the registered consumer during application shutdown', async () => {
    await processor.onModuleInit();
    await processor.onApplicationShutdown();

    expect(rabbit.cancelConsumer).toHaveBeenCalledWith('mail-worker');
  });
});

describe('mail payload validation and error classification', () => {
  it('rejects payload properties that are not in the mail job schema', () => {
    expect(() =>
      validateMailJob(
        { ...validJob(), templatePath: 'C:\\private\\secret.html' },
        config.maxAttachmentSizeBytes,
      ),
    ).toThrow(PermanentMailError);
  });

  it('rejects an oversized decoded attachment', () => {
    expect(() =>
      validateMailJob(
        {
          ...validJob(),
          attachments: [
            {
              filename: 'large.txt',
              contentType: 'text/plain',
              contentBase64: Buffer.alloc(1025).toString('base64'),
            },
          ],
        },
        config.maxAttachmentSizeBytes,
      ),
    ).toThrow(PermanentMailError);
  });

  it('distinguishes permanent SMTP authentication errors from transient failures', () => {
    expect(isRetryableMailFailure({ code: 'EAUTH' })).toBe(false);
    expect(isRetryableMailFailure({ code: 'ETIMEDOUT' })).toBe(true);
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

function validJob(): MailJob {
  return {
    id: 'job-1',
    to: 'user@example.test',
    subject: 'A verification code',
    template: 'otp-verification',
    context: { code: '123456', expiresInMinutes: 10 },
    createdAt: new Date().toISOString(),
  };
}

function messageContext(
  headers: Record<string, unknown> = {},
): TestMessageContext {
  const payload = validJob();
  const properties = {
    contentType: 'application/json',
    contentEncoding: undefined,
    headers,
    messageId: payload.id,
    correlationId: undefined,
    type: undefined,
    appId: undefined,
    timestamp: undefined,
  } as RabbitMQMessageContext['properties'];
  return {
    message: {
      content: Buffer.from(JSON.stringify(payload)),
    } as RabbitMQMessageContext['message'],
    headers,
    properties,
    fields: {} as RabbitMQMessageContext['fields'],
    ack: jest.fn(),
    nack: jest.fn(),
    reject: jest.fn(),
  };
}

type TestMessageContext = Omit<
  RabbitMQMessageContext,
  'ack' | 'nack' | 'reject'
> & {
  ack: jest.Mock;
  nack: jest.Mock;
  reject: jest.Mock;
};
