import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { ConsumeMessage, Options } from 'amqplib';
import {
  RABBITMQ_OPTIONS,
  type RabbitMQRuntimeOptions,
} from './rabbitmq.config';

export type RabbitMQExchangeType = 'direct' | 'topic' | 'fanout' | 'headers';

export interface RabbitMQQueueOptions extends Options.AssertQueue {
  deadLetterExchange?: string;
  deadLetterRoutingKey?: string;
  messageTtl?: number;
  maxLength?: number;
}

export interface RabbitMQConsumerOptions {
  prefetchCount?: number;
  requeueOnError?: boolean;
  consumerOptions?: Omit<Options.Consume, 'noAck' | 'consumerTag'>;
}

export interface RabbitMQMessageContext {
  message: ConsumeMessage;
  headers: ConsumeMessage['properties']['headers'];
  properties: ConsumeMessage['properties'];
  fields: ConsumeMessage['fields'];
  ack(): void;
  nack(requeue?: boolean): void;
  reject(requeue?: boolean): void;
}

export type RabbitMQMessageHandler<T> = (
  payload: T,
  context: RabbitMQMessageContext,
) => void | Promise<void>;

type ManagedChannel = AmqpConnection['managedChannel'];

interface ConsumerRegistration {
  channel: ManagedChannel;
  consumerTag: string | null;
}

@Injectable()
export class RabbitMQService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RabbitMQService.name);
  private readonly consumers = new Map<string, ConsumerRegistration>();
  private readonly inFlight = new Map<string, Set<Promise<void>>>();
  private shuttingDown = false;
  private shutdownPromise?: Promise<void>;

  constructor(
    @Inject(RABBITMQ_OPTIONS)
    private readonly options: RabbitMQRuntimeOptions,
  ) {}

  get isConnected(): boolean {
    return this.options.connection?.connected ?? false;
  }

  async onModuleInit(): Promise<void> {
    const connection = this.options.connection;
    if (!connection) {
      this.logger.warn(
        'RabbitMQ is not configured; messaging operations are unavailable',
      );
      return;
    }

    const initialization = connection.init();
    const manager = connection.managedConnection;
    manager.on('connect', () => {
      this.logger.log(JSON.stringify({ event: 'rabbitmq.connected' }));
    });
    manager.on('connectFailed', ({ err }) => {
      this.logger.error(
        JSON.stringify({
          event: 'rabbitmq.connection.failed',
          error: err.message,
        }),
      );
    });
    manager.on('disconnect', ({ err }) => {
      this.logger.warn(
        JSON.stringify({
          event: 'rabbitmq.disconnected',
          error: err?.message,
        }),
      );
    });
    manager.on('error', (error) => {
      this.logger.error(
        JSON.stringify({
          event: 'rabbitmq.connection.error',
          error: error.message,
        }),
      );
    });
    await initialization;
  }

  assertExchange(
    name: string,
    type: RabbitMQExchangeType = 'topic',
    options: Options.AssertExchange = { durable: true },
  ): Promise<void> {
    return this.runOperation(
      'exchange.assert',
      { exchange: name },
      async () => {
        await this.getConnection().managedChannel.assertExchange(
          name,
          type,
          options,
        );
      },
    );
  }

  async exchangeExists(name: string): Promise<boolean> {
    try {
      await this.getConnection().managedChannel.checkExchange(name);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      this.logOperationFailure('exchange.check', { exchange: name }, error);
      throw error;
    }
  }

  deleteExchange(
    name: string,
    options?: Options.DeleteExchange,
  ): Promise<void> {
    return this.runOperation(
      'exchange.delete',
      { exchange: name },
      async () => {
        await this.getConnection().managedChannel.deleteExchange(name, options);
      },
    );
  }

  assertQueue(
    name: string,
    options: RabbitMQQueueOptions = { durable: true },
  ): Promise<void> {
    return this.runOperation('queue.assert', { queue: name }, async () => {
      const {
        deadLetterExchange,
        deadLetterRoutingKey,
        messageTtl,
        maxLength,
        ...assertOptions
      } = options;
      const argumentsMap = { ...assertOptions.arguments };
      if (deadLetterExchange !== undefined) {
        argumentsMap['x-dead-letter-exchange'] = deadLetterExchange;
      }
      if (deadLetterRoutingKey !== undefined) {
        argumentsMap['x-dead-letter-routing-key'] = deadLetterRoutingKey;
      }
      if (messageTtl !== undefined) {
        argumentsMap['x-message-ttl'] = messageTtl;
      }
      if (maxLength !== undefined) {
        argumentsMap['x-max-length'] = maxLength;
      }

      await this.getConnection().managedChannel.assertQueue(name, {
        ...assertOptions,
        ...(Object.keys(argumentsMap).length > 0
          ? { arguments: argumentsMap }
          : {}),
      });
    });
  }

  async queueExists(name: string): Promise<boolean> {
    try {
      await this.getConnection().managedChannel.checkQueue(name);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      this.logOperationFailure('queue.check', { queue: name }, error);
      throw error;
    }
  }

  getQueueStats(
    name: string,
  ): Promise<{ messageCount: number; consumerCount: number }> {
    return this.runOperation('queue.stats', { queue: name }, async () => {
      const { messageCount, consumerCount } =
        await this.getConnection().managedChannel.checkQueue(name);
      return { messageCount, consumerCount };
    });
  }

  async waitForConnection(): Promise<void> {
    if (this.isConnected) return;
    await this.getConnection().managedChannel.waitForConnect();
  }

  deleteQueue(name: string, options?: Options.DeleteQueue): Promise<void> {
    return this.runOperation('queue.delete', { queue: name }, async () => {
      await this.getConnection().managedChannel.deleteQueue(name, options);
    });
  }

  purgeQueue(name: string): Promise<void> {
    return this.runOperation('queue.purge', { queue: name }, async () => {
      await this.getConnection().managedChannel.purgeQueue(name);
    });
  }

  bindQueue(
    queue: string,
    exchange: string,
    routingKey = '',
    argumentsMap?: Record<string, unknown>,
  ): Promise<void> {
    return this.runOperation(
      'queue.bind',
      { queue, exchange, routingKey },
      async () => {
        await this.getConnection().managedChannel.bindQueue(
          queue,
          exchange,
          routingKey,
          argumentsMap,
        );
      },
    );
  }

  unbindQueue(
    queue: string,
    exchange: string,
    routingKey = '',
    argumentsMap?: Record<string, unknown>,
  ): Promise<void> {
    return this.runOperation(
      'queue.unbind',
      { queue, exchange, routingKey },
      async () => {
        await this.getConnection().managedChannel.unbindQueue(
          queue,
          exchange,
          routingKey,
          argumentsMap,
        );
      },
    );
  }

  bindExchange(
    destination: string,
    source: string,
    routingKey = '',
    argumentsMap?: Record<string, unknown>,
  ): Promise<void> {
    return this.runOperation(
      'exchange.bind',
      { destination, source, routingKey },
      async () => {
        await this.getConnection().managedChannel.bindExchange(
          destination,
          source,
          routingKey,
          argumentsMap,
        );
      },
    );
  }

  unbindExchange(
    destination: string,
    source: string,
    routingKey = '',
    argumentsMap?: Record<string, unknown>,
  ): Promise<void> {
    return this.runOperation(
      'exchange.unbind',
      { destination, source, routingKey },
      async () => {
        await this.getConnection().managedChannel.unbindExchange(
          destination,
          source,
          routingKey,
          argumentsMap,
        );
      },
    );
  }

  publish<T>(
    exchange: string,
    routingKey: string,
    payload: T,
    options: Options.Publish = {},
  ): Promise<boolean> {
    return this.runOperation(
      'message.publish',
      { exchange, routingKey, messageId: options.messageId },
      () =>
        this.getConnection().publish(
          exchange,
          routingKey,
          this.serialize(payload),
          {
            persistent: true,
            contentType: Buffer.isBuffer(payload)
              ? 'application/octet-stream'
              : 'application/json',
            ...options,
          },
        ),
    );
  }

  sendToQueue<T>(
    queue: string,
    payload: T,
    options: Options.Publish = {},
  ): Promise<boolean> {
    return this.runOperation(
      'message.send_to_queue',
      { queue, messageId: options.messageId },
      () =>
        this.getConnection().managedChannel.sendToQueue(
          queue,
          this.serialize(payload),
          {
            persistent: true,
            contentType: Buffer.isBuffer(payload)
              ? 'application/octet-stream'
              : 'application/json',
            ...options,
          },
        ),
    );
  }

  async consume<T>(
    consumerId: string,
    queue: string,
    handler: RabbitMQMessageHandler<T>,
    options: RabbitMQConsumerOptions = {},
  ): Promise<string> {
    if (this.shuttingDown) {
      throw new ServiceUnavailableException(
        'RabbitMQ service is shutting down',
      );
    }
    if (this.consumers.has(consumerId)) {
      throw new ConflictException(
        `RabbitMQ consumer "${consumerId}" is already registered`,
      );
    }

    const connection = this.getConnection();
    const prefetchCount = options.prefetchCount ?? this.options.prefetchCount;
    if (!Number.isInteger(prefetchCount) || prefetchCount < 1) {
      throw new Error('Consumer prefetchCount must be a positive integer');
    }

    const channel = connection.managedConnection.createChannel({
      name: `consumer:${consumerId}`,
    });
    const registration: ConsumerRegistration = {
      channel,
      consumerTag: null,
    };
    this.consumers.set(consumerId, registration);

    try {
      const result = await channel.consume(
        queue,
        (message) => {
          if (!message) {
            this.logger.warn(
              JSON.stringify({
                event: 'rabbitmq.consumer.cancelled',
                consumerId,
                queue,
              }),
            );
            return;
          }
          const task = this.handleMessage(
            consumerId,
            queue,
            message,
            channel,
            handler,
            options.requeueOnError ?? false,
          );
          this.trackMessage(consumerId, task);
        },
        {
          ...options.consumerOptions,
          consumerTag: consumerId,
          noAck: false,
          prefetch: prefetchCount,
        },
      );
      registration.consumerTag = result.consumerTag;
      return result.consumerTag;
    } catch (error) {
      this.consumers.delete(consumerId);
      try {
        await channel.close();
      } catch (closeError) {
        this.logOperationFailure(
          'consumer.channel_close',
          { consumerId, queue },
          closeError,
        );
      }
      this.logOperationFailure(
        'consumer.register',
        { consumerId, queue },
        error,
      );
      throw error;
    }
  }

  async cancelConsumer(consumerId: string): Promise<void> {
    const registration = this.consumers.get(consumerId);
    if (!registration) return;

    await this.runOperation('consumer.cancel', { consumerId }, async () => {
      if (registration.consumerTag) {
        await registration.channel.cancel(registration.consumerTag);
      }
      await this.waitForConsumer(consumerId);
      await registration.channel.close();
      this.consumers.delete(consumerId);
    });
  }

  serialize<T>(payload: T): Buffer {
    if (Buffer.isBuffer(payload)) return payload;
    const serialized = JSON.stringify(payload);
    if (serialized === undefined) {
      throw new TypeError('RabbitMQ payload is not JSON serializable');
    }
    return Buffer.from(serialized, 'utf8');
  }

  deserialize<T>(content: Buffer): T {
    return JSON.parse(content.toString('utf8')) as T;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    this.shutdownPromise = this.shutdown();
    return this.shutdownPromise;
  }

  private async shutdown(): Promise<void> {
    const registrations = [...this.consumers.entries()];
    const cancellationResults = await Promise.allSettled(
      registrations.map(async ([, { channel, consumerTag }]) => {
        if (consumerTag) await channel.cancel(consumerTag);
      }),
    );
    for (const result of cancellationResults) {
      if (result.status === 'rejected') {
        this.logOperationFailure(
          'consumer.cancel_during_shutdown',
          {},
          result.reason,
        );
      }
    }
    const pendingProcessing = [...this.inFlight.values()].flatMap((tasks) => [
      ...tasks,
    ]);
    await Promise.allSettled(pendingProcessing);

    const closeResults = await Promise.allSettled(
      registrations.map(([, { channel }]) => channel.close()),
    );
    for (const result of closeResults) {
      if (result.status === 'rejected') {
        this.logOperationFailure(
          'consumer.close_during_shutdown',
          {},
          result.reason,
        );
      }
    }
    this.consumers.clear();
    this.inFlight.clear();
    await this.options.connection?.close();
  }

  private trackMessage(consumerId: string, task: Promise<void>): void {
    const tasks = this.inFlight.get(consumerId) ?? new Set<Promise<void>>();
    tasks.add(task);
    this.inFlight.set(consumerId, tasks);
    void task.then(() => {
      tasks.delete(task);
      if (tasks.size === 0) this.inFlight.delete(consumerId);
    });
  }

  private async waitForConsumer(consumerId: string): Promise<void> {
    const tasks = this.inFlight.get(consumerId);
    if (tasks) await Promise.allSettled(tasks);
  }

  private async handleMessage<T>(
    consumerId: string,
    queue: string,
    message: ConsumeMessage,
    channel: ManagedChannel,
    handler: RabbitMQMessageHandler<T>,
    requeueOnError: boolean,
  ): Promise<void> {
    let settled = false;
    const context: RabbitMQMessageContext = {
      message,
      headers: message.properties.headers,
      properties: message.properties,
      fields: message.fields,
      ack: () => {
        if (settled) return;
        settled = true;
        channel.ack(message);
      },
      nack: (requeue = false) => {
        if (settled) return;
        settled = true;
        channel.nack(message, false, requeue);
      },
      reject: (requeue = false) => {
        if (settled) return;
        settled = true;
        channel.nack(message, false, requeue);
      },
    };

    try {
      const payload = this.deserialize<T>(message.content);
      await handler(payload, context);
      if (!settled) context.ack();
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'rabbitmq.message.processing_failed',
          consumerId,
          queue,
          messageId: message.properties.messageId,
          error: errorMessage(error),
        }),
      );
      if (!settled) {
        try {
          context.nack(requeueOnError);
        } catch (ackError) {
          this.logOperationFailure(
            'message.nack',
            { consumerId, queue, messageId: message.properties.messageId },
            ackError,
          );
        }
      }
    }
  }

  private getConnection(): AmqpConnection {
    if (this.shuttingDown) {
      throw new ServiceUnavailableException(
        'RabbitMQ service is shutting down',
      );
    }
    if (!this.options.connection) {
      throw new ServiceUnavailableException(
        'RabbitMQ is not configured; messaging operations are unavailable',
      );
    }
    return this.options.connection;
  }

  private async runOperation<T>(
    operation: string,
    details: Record<string, unknown>,
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      this.logOperationFailure(operation, details, error);
      throw error;
    }
  }

  private logOperationFailure(
    operation: string,
    details: Record<string, unknown>,
    error: unknown,
  ): void {
    this.logger.error(
      JSON.stringify({
        event: `rabbitmq.${operation}.failed`,
        ...details,
        error: errorMessage(error),
      }),
    );
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (
    ('code' in error && (error.code === 404 || error.code === '404')) ||
    ('replyCode' in error &&
      (error.replyCode === 404 || error.replyCode === '404'))
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
