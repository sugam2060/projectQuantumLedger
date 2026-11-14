import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import {
  ConflictException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { ConsumeMessage } from 'amqplib';
import { EventEmitter } from 'events';
import {
  createRabbitMQOptions,
  type RabbitMQRuntimeOptions,
} from '../rabbitmq.config';
import { RabbitMQService } from '../rabbitmq.service';

describe('RabbitMQService', () => {
  let service: RabbitMQService;
  let connection: AmqpConnection;
  let manager: EventEmitter & { createChannel: jest.Mock };
  let managedChannel: Record<string, jest.Mock>;
  let consumerChannel: Record<string, jest.Mock>;
  let connectionInit: jest.Mock;
  let connectionClose: jest.Mock;
  let connectionPublish: jest.Mock;
  let onMessage: ((message: ConsumeMessage | null) => void) | undefined;

  beforeEach(() => {
    jest.restoreAllMocks();
    onMessage = undefined;

    managedChannel = {
      assertExchange: jest.fn().mockResolvedValue({}),
      checkExchange: jest.fn().mockResolvedValue({}),
      deleteExchange: jest.fn().mockResolvedValue({}),
      assertQueue: jest.fn().mockResolvedValue({}),
      checkQueue: jest.fn().mockResolvedValue({}),
      deleteQueue: jest.fn().mockResolvedValue({}),
      purgeQueue: jest.fn().mockResolvedValue({}),
      bindQueue: jest.fn().mockResolvedValue(undefined),
      unbindQueue: jest.fn().mockResolvedValue(undefined),
      bindExchange: jest.fn().mockResolvedValue(undefined),
      unbindExchange: jest.fn().mockResolvedValue(undefined),
      sendToQueue: jest.fn().mockResolvedValue(true),
    };
    consumerChannel = {
      consume: jest.fn(
        async (
          _queue: string,
          callback: (message: ConsumeMessage | null) => void,
        ) => {
          onMessage = callback;
          return { consumerTag: 'consumer-tag' };
        },
      ),
      cancel: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      ack: jest.fn(),
      nack: jest.fn(),
    };
    manager = Object.assign(new EventEmitter(), {
      createChannel: jest.fn(() => consumerChannel),
    });
    connectionInit = jest.fn().mockResolvedValue(undefined);
    connectionClose = jest.fn().mockResolvedValue(undefined);
    connectionPublish = jest.fn().mockResolvedValue(true);
    connection = {
      init: connectionInit,
      close: connectionClose,
      managedConnection: manager,
      managedChannel,
      connected: true,
      publish: connectionPublish,
    } as unknown as AmqpConnection;
    const options: RabbitMQRuntimeOptions = {
      connection,
      prefetchCount: 4,
    };
    service = new RabbitMQService(options);
  });

  it('initializes the shared reconnecting connection and reports its health', async () => {
    await service.onModuleInit();

    expect(connectionInit).toHaveBeenCalledTimes(1);
    expect(service.isConnected).toBe(true);
    expect(manager.listenerCount('connectFailed')).toBe(1);
  });

  it('logs connection failures reported by the reconnecting manager', async () => {
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    await service.onModuleInit();

    manager.emit('connectFailed', { err: new Error('broker unavailable') });

    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('"event":"rabbitmq.connection.failed"'),
    );
  });

  it('starts without RabbitMQ configuration and fails operations explicitly', async () => {
    const disabledService = new RabbitMQService({
      connection: null,
      prefetchCount: 4,
    });

    await disabledService.onModuleInit();
    await expect(
      disabledService.assertExchange('events'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('asserts exchanges and queues with dead-letter options', async () => {
    await service.assertExchange('events', 'topic');
    await service.assertQueue('events.process', {
      durable: true,
      deadLetterExchange: 'events.dead',
      deadLetterRoutingKey: 'events.failed',
      messageTtl: 60000,
      maxLength: 1000,
    });

    expect(managedChannel.assertExchange).toHaveBeenCalledWith(
      'events',
      'topic',
      { durable: true },
    );
    expect(managedChannel.assertQueue).toHaveBeenCalledWith('events.process', {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'events.dead',
        'x-dead-letter-routing-key': 'events.failed',
        'x-message-ttl': 60000,
        'x-max-length': 1000,
      },
    });
  });

  it('binds queues to exchanges', async () => {
    await service.bindQueue('events.process', 'events', 'events.created', {
      tenant: 'north',
    });

    expect(managedChannel.bindQueue).toHaveBeenCalledWith(
      'events.process',
      'events',
      'events.created',
      { tenant: 'north' },
    );
  });

  it('publishes persistent JSON messages with publisher confirmation', async () => {
    const payload = { id: 'job-1' };

    await expect(
      service.publish('events', 'events.created', payload, {
        correlationId: 'correlation-1',
      }),
    ).resolves.toBe(true);

    expect(connectionPublish).toHaveBeenCalledWith(
      'events',
      'events.created',
      Buffer.from(JSON.stringify(payload)),
      {
        persistent: true,
        contentType: 'application/json',
        correlationId: 'correlation-1',
      },
    );
  });

  it('acknowledges messages after successful processing', async () => {
    const handler = jest.fn();
    await service.consume('email-worker', 'email.send', handler);

    expect(manager.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'consumer:email-worker' }),
    );
    expect(consumerChannel.consume).toHaveBeenCalledWith(
      'email.send',
      expect.any(Function),
      expect.objectContaining({ consumerTag: 'email-worker', noAck: false }),
    );

    onMessage?.(message({ to: 'user@example.test' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler).toHaveBeenCalledWith(
      { to: 'user@example.test' },
      expect.objectContaining({ ack: expect.any(Function) }),
    );
    expect(consumerChannel.ack).toHaveBeenCalledTimes(1);
    expect(consumerChannel.nack).not.toHaveBeenCalled();
  });

  it('nacks failed messages according to the configured requeue policy', async () => {
    await service.consume(
      'payment-worker',
      'payment.process',
      async () => {
        throw new Error('processor failed');
      },
      { requeueOnError: true },
    );

    const failedMessage = message({ paymentId: 'payment-1' });
    onMessage?.(failedMessage);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consumerChannel.nack).toHaveBeenCalledWith(
      failedMessage,
      false,
      true,
    );
    expect(consumerChannel.ack).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON without requeueing it', async () => {
    await service.consume('json-worker', 'jobs', async () => undefined);
    const malformed = {
      ...message({}),
      content: Buffer.from('invalid JSON'),
    };

    onMessage?.(malformed);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consumerChannel.nack).toHaveBeenCalledWith(malformed, false, false);
  });

  it('prevents duplicate registration and cancels consumers during shutdown', async () => {
    await service.consume('worker', 'jobs', async () => undefined);
    await expect(
      service.consume('worker', 'jobs', async () => undefined),
    ).rejects.toBeInstanceOf(ConflictException);

    await service.onApplicationShutdown();

    expect(consumerChannel.cancel).toHaveBeenCalledWith('consumer-tag');
    expect(consumerChannel.close).toHaveBeenCalledTimes(1);
    expect(connectionClose).toHaveBeenCalledTimes(1);
  });

  it('waits for in-flight handlers before closing consumer channels', async () => {
    let finishProcessing: (() => void) | undefined;
    await service.consume(
      'slow-worker',
      'slow-jobs',
      () =>
        new Promise<void>((resolve) => {
          finishProcessing = resolve;
        }),
    );
    onMessage?.(message({ jobId: 'job-1' }));

    const shutdown = service.onApplicationShutdown();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consumerChannel.close).not.toHaveBeenCalled();

    finishProcessing?.();
    await shutdown;

    expect(consumerChannel.ack).toHaveBeenCalledTimes(1);
    expect(consumerChannel.close).toHaveBeenCalledTimes(1);
  });
});

describe('createRabbitMQOptions', () => {
  function config(values: Record<string, string>): ConfigService {
    return {
      get: (name: string) => values[name],
    } as unknown as ConfigService;
  }

  it('prefers the URI and validates its scheme', async () => {
    const options = await createRabbitMQOptions(
      config({
        RABBITMQ_URL: 'amqps://user:secret@broker.example/vhost',
        RABBITMQ_HEARTBEAT: '45',
      }),
    );

    expect(options.connection?.configuration.uri).toContain('heartbeat=45');
    expect(options.prefetchCount).toBe(10);
    await expect(
      createRabbitMQOptions(config({ RABBITMQ_URL: 'http://bad.example' })),
    ).rejects.toThrow('RABBITMQ_URL must be a valid amqp:// or amqps:// URL');
  });

  it('builds a URI from validated host settings', async () => {
    const options = await createRabbitMQOptions(
      config({
        RABBITMQ_HOST: 'broker.example',
        RABBITMQ_PORT: '5673',
        RABBITMQ_USERNAME: 'service',
        RABBITMQ_PASSWORD: 'secret',
        RABBITMQ_VHOST: 'quantum ledger',
      }),
    );

    expect(options.connection?.configuration.uri).toContain(
      'amqp://service:secret@broker.example:5673/quantum%20ledger',
    );
  });

  it('rejects incomplete host settings and invalid numeric configuration', async () => {
    await expect(
      createRabbitMQOptions(config({ RABBITMQ_HOST: 'broker.example' })),
    ).rejects.toThrow('Set RABBITMQ_URL, or configure');
    await expect(
      createRabbitMQOptions(config({ RABBITMQ_PREFETCH_COUNT: '0' })),
    ).rejects.toThrow('RABBITMQ_PREFETCH_COUNT must be a positive integer');
  });
});

function message(payload: unknown): ConsumeMessage {
  return {
    content: Buffer.from(JSON.stringify(payload)),
    fields: {
      consumerTag: 'consumer-tag',
      deliveryTag: 1,
      redelivered: false,
      exchange: 'jobs',
      routingKey: 'jobs.process',
    },
    properties: {
      contentType: 'application/json',
      contentEncoding: undefined,
      headers: {},
      deliveryMode: undefined,
      priority: undefined,
      correlationId: undefined,
      replyTo: undefined,
      expiration: undefined,
      messageId: 'message-1',
      timestamp: undefined,
      type: undefined,
      userId: undefined,
      appId: undefined,
      clusterId: undefined,
    },
  };
}
