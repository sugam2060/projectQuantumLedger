import { ConfigService } from '@nestjs/config';
import { isEmail } from 'class-validator';

export interface MailRuntimeConfig {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpPassword: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  queueName: string;
  exchangeName: string;
  routingKey: string;
  workerConcurrency: number;
  prefetchCount: number;
  maxRetries: number;
  retryInitialDelayMs: number;
  retryMaxDelayMs: number;
  dlqEnabled: boolean;
  dlqExchange: string;
  dlqQueue: string;
  dlqRoutingKey: string;
  dlqCheckIntervalMs: number;
  idempotencyTtlSeconds: number;
  idempotencyLockTtlSeconds: number;
  maxAttachmentSizeBytes: number;
}

export function createMailRuntimeConfig(
  config: ConfigService,
): MailRuntimeConfig {
  const secureText = requiredString(config, 'MAIL_SECURE').toLowerCase();
  if (secureText !== 'true' && secureText !== 'false') {
    throw new Error('MAIL_SECURE must be either true or false');
  }

  const fromEmail = requiredString(config, 'MAIL_FROM_EMAIL');
  if (!isEmail(fromEmail)) {
    throw new Error('MAIL_FROM_EMAIL must be a valid email address');
  }

  const replyTo = config.get<string>('MAIL_REPLY_TO')?.trim() || undefined;
  if (replyTo && !isEmail(replyTo)) {
    throw new Error('MAIL_REPLY_TO must be a valid email address');
  }

  const retryInitialDelayMs = positiveInteger(
    config,
    'MAIL_RETRY_INITIAL_DELAY',
  );
  const retryMaxDelayMs = positiveInteger(config, 'MAIL_RETRY_MAX_DELAY');
  if (retryInitialDelayMs > retryMaxDelayMs) {
    throw new Error(
      'MAIL_RETRY_INITIAL_DELAY must not exceed MAIL_RETRY_MAX_DELAY',
    );
  }

  return {
    smtpHost: requiredString(config, 'MAIL_HOST'),
    smtpPort: boundedInteger(config, 'MAIL_PORT', 1, 65535),
    smtpSecure: secureText === 'true',
    smtpUsername: requiredString(config, 'MAIL_USERNAME'),
    smtpPassword: requiredString(config, 'MAIL_PASSWORD', false),
    fromName: requiredString(config, 'MAIL_FROM_NAME'),
    fromEmail,
    replyTo,
    queueName: requiredString(config, 'MAIL_QUEUE_NAME'),
    exchangeName: requiredString(config, 'MAIL_EXCHANGE_NAME'),
    routingKey: requiredString(config, 'MAIL_ROUTING_KEY'),
    workerConcurrency: boundedInteger(
      config,
      'MAIL_WORKER_CONCURRENCY',
      1,
      1000,
    ),
    prefetchCount: boundedInteger(config, 'MAIL_PREFETCH_COUNT', 1, 1000),
    maxRetries: boundedInteger(config, 'MAIL_MAX_RETRIES', 0, 20),
    retryInitialDelayMs,
    retryMaxDelayMs,
    dlqEnabled: strictBoolean(config, 'MAIL_DLQ_ENABLED'),
    dlqExchange: requiredString(config, 'MAIL_DLQ_EXCHANGE'),
    dlqQueue: requiredString(config, 'MAIL_DLQ_QUEUE'),
    dlqRoutingKey: requiredString(config, 'MAIL_DLQ_ROUTING_KEY'),
    dlqCheckIntervalMs: positiveInteger(config, 'MAIL_DLQ_CHECK_INTERVAL'),
    idempotencyTtlSeconds: positiveInteger(
      config,
      'MAIL_IDEMPOTENCY_TTL_SECONDS',
    ),
    idempotencyLockTtlSeconds: positiveInteger(
      config,
      'MAIL_IDEMPOTENCY_LOCK_TTL_SECONDS',
    ),
    maxAttachmentSizeBytes: positiveInteger(
      config,
      'MAIL_MAX_ATTACHMENT_SIZE_BYTES',
    ),
  };
}

function requiredString(
  config: ConfigService,
  name: string,
  trim = true,
): string {
  const value = config.get<string>(name);
  if (
    value === undefined ||
    value.length === 0 ||
    (trim && value.trim() === '')
  ) {
    throw new Error(`${name} is required`);
  }
  return trim ? value.trim() : value;
}

function positiveInteger(config: ConfigService, name: string): number {
  return boundedInteger(config, name, 1, Number.MAX_SAFE_INTEGER);
}

function boundedInteger(
  config: ConfigService,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const value = requiredString(config, name);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return parsed;
}

function strictBoolean(config: ConfigService, name: string): boolean {
  const value = requiredString(config, name).toLowerCase();
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${name} must be either true or false`);
  }
  return value === 'true';
}
