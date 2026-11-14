import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { randomUUID } from 'node:crypto';
import {
  RabbitMQService,
  type RabbitMQMessageContext,
} from '../../../utils/rabbitmq.service';
import { RedisService } from '../../../redis/redis.service';
import {
  MAIL_CONFIG,
  MAIL_CONSUMER_ID,
  MAIL_RETRY_COUNT_HEADER,
} from '../mail.constants';
import type { MailRuntimeConfig } from '../mail.config';
import { MailService } from '../mail.service';
import {
  MailJobPayload,
  PermanentMailError,
  RetryableMailError,
  type MailJob,
} from '../mail.types';

const TRANSIENT_SMTP_CODES = new Set([
  'ECONNECTION',
  'ETIMEDOUT',
  'ESOCKET',
  'EDNS',
  'EPROTOCOL',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNABORTED',
  'ESOCKETTIMEDOUT',
]);
const PERMANENT_SMTP_CODES = new Set(['EAUTH', 'ENOAUTH', 'EOAUTH2', 'ETLS']);

@Injectable()
export class MailProcessor implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MailProcessor.name);
  private registered = false;

  constructor(
    private readonly rabbit: RabbitMQService,
    private readonly mailer: MailService,
    private readonly redis: RedisService,
    @Inject(MAIL_CONFIG)
    private readonly config: MailRuntimeConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.rabbit.waitForConnection();
    await this.declareTopology();
    await this.rabbit.consume(
      MAIL_CONSUMER_ID,
      this.config.queueName,
      (payload, context) => this.handle(payload, context),
      {
        prefetchCount: Math.min(
          this.config.prefetchCount,
          this.config.workerConcurrency,
        ),
      },
    );
    this.registered = true;
    this.logger.log(
      JSON.stringify({
        event: 'mail.worker.started',
        queue: this.config.queueName,
        concurrency: Math.min(
          this.config.workerConcurrency,
          this.config.prefetchCount,
        ),
      }),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.registered) return;
    await this.rabbit.cancelConsumer(MAIL_CONSUMER_ID);
    this.registered = false;
  }

  private async declareTopology(): Promise<void> {
    await this.rabbit.assertExchange(this.config.exchangeName, 'topic', {
      durable: true,
    });
    await this.rabbit.assertQueue(this.config.queueName, {
      durable: true,
      ...(this.config.dlqEnabled
        ? {
            deadLetterExchange: this.config.dlqExchange,
            deadLetterRoutingKey: this.config.dlqRoutingKey,
          }
        : {}),
    });
    await this.rabbit.bindQueue(
      this.config.queueName,
      this.config.exchangeName,
      this.config.routingKey,
    );

    if (this.config.dlqEnabled) {
      await this.rabbit.assertExchange(this.config.dlqExchange, 'direct', {
        durable: true,
      });
      await this.rabbit.assertQueue(this.config.dlqQueue, { durable: true });
      await this.rabbit.bindQueue(
        this.config.dlqQueue,
        this.config.dlqExchange,
        this.config.dlqRoutingKey,
      );
    }

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt += 1) {
      await this.rabbit.assertQueue(this.retryQueueName(attempt), {
        durable: true,
        messageTtl: this.retryDelay(attempt),
        deadLetterExchange: this.config.exchangeName,
        deadLetterRoutingKey: this.config.routingKey,
      });
    }
  }

  private async handle(
    payload: unknown,
    context: RabbitMQMessageContext,
  ): Promise<void> {
    let retryCount: number;
    try {
      retryCount = readRetryCount(context.headers);
    } catch (error) {
      await this.routePermanentFailure(context, undefined, error, 0);
      return;
    }

    let job: MailJob;
    try {
      job = validateMailJob(payload, this.config.maxAttachmentSizeBytes);
    } catch (error) {
      await this.routePermanentFailure(context, undefined, error, retryCount);
      return;
    }

    try {
      const alreadySent = await this.deliverIdempotently(job);
      if (alreadySent) {
        this.logger.warn(
          JSON.stringify({
            event: 'mail.duplicate.acknowledged',
            jobId: job.id,
            correlationId: job.correlationId,
          }),
        );
      }
    } catch (error) {
      if (
        isRetryableMailFailure(error) &&
        retryCount < this.config.maxRetries
      ) {
        await this.scheduleRetry(job, context, retryCount + 1, error);
        return;
      }
      await this.routePermanentFailure(context, job, error, retryCount);
    }
  }

  private async deliverIdempotently(job: MailJob): Promise<boolean> {
    const sentKey = `mail:sent:${job.id}`;
    if (await this.redis.exists(sentKey)) return true;

    const lockKey = `mail:lock:${job.id}`;
    const lockToken = randomUUID();
    const locked = await this.redis.setIfAbsent(
      lockKey,
      lockToken,
      this.config.idempotencyLockTtlSeconds,
    );
    if (!locked) {
      if (await this.redis.exists(sentKey)) return true;
      throw new RetryableMailError(
        'The mail job is already being processed',
        'DELIVERY_IN_PROGRESS',
      );
    }

    let deliveryFailed = false;
    let deliveryError: unknown;
    let alreadySent = false;
    try {
      if (await this.redis.exists(sentKey)) {
        alreadySent = true;
      } else {
        await this.mailer.send(job);
        await this.redis.set(
          sentKey,
          'sent',
          this.config.idempotencyTtlSeconds,
        );
      }
    } catch (error) {
      deliveryFailed = true;
      deliveryError = error;
    }

    let releaseFailed = false;
    let releaseError: unknown;
    try {
      await this.redis.compareAndDelete(lockKey, lockToken);
    } catch (error) {
      releaseFailed = true;
      releaseError = error;
      this.logger.error(
        JSON.stringify({
          event: 'mail.idempotency_lock.release_failed',
          jobId: job.id,
          error: errorMessage(error),
        }),
      );
    }

    if (deliveryFailed) throw deliveryError;
    if (releaseFailed) throw releaseError;
    return alreadySent;
  }

  private async scheduleRetry(
    job: MailJob,
    context: RabbitMQMessageContext,
    attempt: number,
    error: unknown,
  ): Promise<void> {
    const retryQueue = this.retryQueueName(attempt);
    try {
      const confirmed = await this.rabbit.publish(
        '',
        retryQueue,
        context.message.content,
        {
          persistent: true,
          contentType:
            context.properties.contentType ?? 'application/octet-stream',
          contentEncoding: context.properties.contentEncoding,
          messageId: context.properties.messageId ?? job.id,
          correlationId: context.properties.correlationId ?? job.correlationId,
          type: context.properties.type,
          appId: context.properties.appId,
          timestamp: context.properties.timestamp,
          headers: {
            ...context.headers,
            [MAIL_RETRY_COUNT_HEADER]: attempt,
          },
        },
      );
      if (!confirmed) throw new Error('RabbitMQ did not confirm the retry');
      context.ack();
      this.logger.warn(
        JSON.stringify({
          event: 'mail.retry.scheduled',
          jobId: job.id,
          correlationId: job.correlationId,
          attempt,
          delayMs: this.retryDelay(attempt),
          retryQueue,
          failureCode: failureCode(error),
        }),
      );
    } catch (publishError) {
      this.logRepublishFailure(job, publishError, 'retry');
      context.nack(true);
    }
  }

  private async routePermanentFailure(
    context: RabbitMQMessageContext,
    job: MailJob | undefined,
    error: unknown,
    retryCount: number,
  ): Promise<void> {
    const code = failureCode(error);
    const reason = errorMessage(error).slice(0, 1000);
    if (!this.config.dlqEnabled) {
      this.logger.error(
        JSON.stringify({
          event: 'mail.failure.rejected_without_dlq',
          jobId: job?.id ?? context.properties.messageId,
          correlationId: job?.correlationId ?? context.properties.correlationId,
          failureCode: code,
          retryCount,
          error: reason,
        }),
      );
      context.reject(false);
      return;
    }

    try {
      const confirmed = await this.rabbit.publish(
        this.config.dlqExchange,
        this.config.dlqRoutingKey,
        context.message.content,
        {
          persistent: true,
          contentType:
            context.properties.contentType ?? 'application/octet-stream',
          contentEncoding: context.properties.contentEncoding,
          messageId: context.properties.messageId ?? job?.id,
          correlationId: context.properties.correlationId ?? job?.correlationId,
          type: context.properties.type,
          appId: context.properties.appId,
          timestamp: context.properties.timestamp,
          headers: {
            ...context.headers,
            [MAIL_RETRY_COUNT_HEADER]: retryCount,
            'x-mail-failure-code': code,
            'x-mail-failure-reason': reason,
          },
        },
      );
      if (!confirmed)
        throw new Error('RabbitMQ did not confirm the DLQ message');
      context.ack();
      this.logger.error(
        JSON.stringify({
          event: 'mail.dead_lettered',
          jobId: job?.id ?? context.properties.messageId,
          correlationId: job?.correlationId ?? context.properties.correlationId,
          failureCode: code,
          retryCount,
          error: reason,
        }),
      );
    } catch (publishError) {
      this.logRepublishFailure(job, publishError, 'dead-letter');
      context.nack(true);
    }
  }

  private retryQueueName(attempt: number): string {
    return `${this.config.queueName}.retry.${attempt}`;
  }

  private retryDelay(attempt: number): number {
    return Math.min(
      this.config.retryInitialDelayMs * 2 ** (attempt - 1),
      this.config.retryMaxDelayMs,
    );
  }

  private logRepublishFailure(
    job: MailJob | undefined,
    error: unknown,
    destination: string,
  ): void {
    this.logger.error(
      JSON.stringify({
        event: 'mail.republish_failed',
        destination,
        jobId: job?.id,
        correlationId: job?.correlationId,
        error: errorMessage(error),
      }),
    );
  }
}

export function validateMailJob(
  payload: unknown,
  maxAttachmentSizeBytes: number,
): MailJobPayload {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new PermanentMailError(
      'Mail job payload must be a JSON object',
      'INVALID_PAYLOAD',
    );
  }

  const job = plainToInstance(MailJobPayload, payload);
  const errors = validateSync(job, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });
  if (errors.length > 0) {
    throw new PermanentMailError(
      `Mail job validation failed: ${summarizeValidationErrors(errors)}`,
      'INVALID_PAYLOAD',
    );
  }

  for (const attachment of job.attachments ?? []) {
    const content = Buffer.from(attachment.contentBase64, 'base64');
    if (
      content.toString('base64') !== attachment.contentBase64 ||
      content.byteLength > maxAttachmentSizeBytes
    ) {
      throw new PermanentMailError(
        `Attachment "${attachment.filename}" is invalid or exceeds the size limit`,
        'INVALID_ATTACHMENT',
      );
    }
  }
  return job;
}

export function isRetryableMailFailure(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5 && isRecord(current); depth += 1) {
    if (current.permanent === true) return false;
    if (typeof current.responseCode === 'number') {
      return current.responseCode >= 400 && current.responseCode < 500;
    }
    if (typeof current.code === 'string') {
      if (PERMANENT_SMTP_CODES.has(current.code)) return false;
      if (TRANSIENT_SMTP_CODES.has(current.code)) return true;
    }
    current = current.cause ?? current.originalError;
  }
  return true;
}

function readRetryCount(headers: Record<string, unknown> | undefined): number {
  const value = headers?.[MAIL_RETRY_COUNT_HEADER];
  if (value === undefined) return 0;
  const count =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new PermanentMailError(
      'Mail retry count header is invalid',
      'INVALID_RETRY_COUNT',
    );
  }
  return count;
}

function summarizeValidationErrors(
  errors: ReturnType<typeof validateSync>,
): string {
  return errors
    .flatMap((error) => Object.values(error.constraints ?? {}))
    .join('; ')
    .slice(0, 500);
}

function failureCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === 'string') return error.code;
  return isRetryableMailFailure(error)
    ? 'TRANSIENT_FAILURE'
    : 'PERMANENT_FAILURE';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
