import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import amqp, { Channel, ChannelModel } from 'amqplib';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private connection?: ChannelModel;
  private channel?: Channel;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    this.connection = await amqp.connect(
      this.config.getOrThrow<string>('RABBITMQ_URL'),
    );
    this.channel = await this.connection.createChannel();
  }

  async publish(queue: string, message: unknown): Promise<boolean> {
    const channel = this.getChannel();
    await channel.assertQueue(queue, { durable: true });
    return channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
      persistent: true,
      contentType: 'application/json',
    });
  }

  async consume<T>(
    queue: string,
    handler: (message: T) => Promise<void>,
  ): Promise<void> {
    const channel = this.getChannel();
    await channel.assertQueue(queue, { durable: true });
    await channel.consume(queue, async (delivery) => {
      if (!delivery) return;
      try {
        await handler(JSON.parse(delivery.content.toString()) as T);
        channel.ack(delivery);
      } catch {
        channel.nack(delivery, false, false);
        // The delivery is rejected without requeue to avoid an infinite retry
        // loop for messages that consistently fail this consumer.
      }
    });
  }

  async onModuleDestroy() {
    await this.channel?.close();
    await this.connection?.close();
  }

  private getChannel(): Channel {
    if (!this.channel) throw new Error('RabbitMQ channel is not connected');
    return this.channel;
  }
}
