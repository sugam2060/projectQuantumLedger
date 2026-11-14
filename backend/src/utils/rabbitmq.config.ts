import type { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ConfigService } from '@nestjs/config';

export const RABBITMQ_OPTIONS = Symbol('RABBITMQ_OPTIONS');

export interface RabbitMQRuntimeOptions {
  connection: AmqpConnection | null;
  prefetchCount: number;
}

export async function createRabbitMQOptions(
  config: ConfigService,
): Promise<RabbitMQRuntimeOptions> {
  const url = config.get<string>('RABBITMQ_URL')?.trim();
  const host = config.get<string>('RABBITMQ_HOST')?.trim();
  const username = config.get<string>('RABBITMQ_USERNAME')?.trim();
  const password = config.get<string>('RABBITMQ_PASSWORD');
  const heartbeat = readInteger(config, 'RABBITMQ_HEARTBEAT', 30, true);
  const prefetchCount = readInteger(
    config,
    'RABBITMQ_PREFETCH_COUNT',
    10,
    false,
  );
  const connectionTimeout = readInteger(
    config,
    'RABBITMQ_CONNECTION_TIMEOUT',
    10000,
    false,
  );

  if (!url && !host && !username && !password) {
    return { connection: null, prefetchCount };
  }

  let uri: string;
  if (url) {
    try {
      const parsedUrl = new URL(url);
      if (
        !['amqp:', 'amqps:'].includes(parsedUrl.protocol) ||
        !parsedUrl.hostname
      ) {
        throw new Error();
      }
      parsedUrl.searchParams.set('heartbeat', String(heartbeat));
      uri = parsedUrl.toString();
    } catch {
      throw new Error('RABBITMQ_URL must be a valid amqp:// or amqps:// URL');
    }
  } else {
    if (!host || !username || !password) {
      throw new Error(
        'Set RABBITMQ_URL, or configure RABBITMQ_HOST, RABBITMQ_USERNAME, and RABBITMQ_PASSWORD',
      );
    }

    const port = readInteger(config, 'RABBITMQ_PORT', 5672, false);
    if (port > 65535) {
      throw new Error('RABBITMQ_PORT must be between 1 and 65535');
    }

    const parsedUrl = new URL('amqp://placeholder');
    parsedUrl.hostname = host;
    parsedUrl.port = String(port);
    parsedUrl.username = username;
    parsedUrl.password = password;
    parsedUrl.pathname = `/${encodeURIComponent(
      config.get<string>('RABBITMQ_VHOST')?.trim() || '/',
    )}`;
    parsedUrl.searchParams.set('heartbeat', String(heartbeat));
    uri = parsedUrl.toString();
  }

  const connectionOptions = {
    name: 'application',
    uri,
    prefetchCount,
    connectionInitOptions: { wait: false },
    connectionManagerOptions: {
      heartbeatIntervalInSeconds: Math.max(1, heartbeat),
      reconnectTimeInSeconds: Math.max(1, heartbeat),
      connectionOptions: { timeout: connectionTimeout },
    },
  };

  const { AmqpConnection } = await import('@golevelup/nestjs-rabbitmq');
  return {
    connection: new AmqpConnection({
      ...connectionOptions,
    }),
    prefetchCount,
  };
}

function readInteger(
  config: ConfigService,
  name: string,
  defaultValue: number,
  allowZero: boolean,
): number {
  const value = config.get<string>(name);
  if (value === undefined || value.trim() === '') return defaultValue;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || (allowZero ? parsed < 0 : parsed < 1)) {
    throw new Error(
      `${name} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`,
    );
  }
  return parsed;
}
