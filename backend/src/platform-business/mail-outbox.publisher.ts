import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, lte, or } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { mailOutbox } from '../database/schema';
import { RabbitMQService } from '../utils/rabbitmq.service';

const CLAIM_DURATION_MS = 60_000;
const DISPATCH_INTERVAL_MS = 5_000;
const BATCH_SIZE = 20;

@Injectable()
export class MailOutboxPublisher
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(MailOutboxPublisher.name);
  private timer?: NodeJS.Timeout;
  private dispatching = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly rabbit: RabbitMQService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.dispatch(), DISPATCH_INTERVAL_MS);
    this.timer.unref();
    void this.dispatch();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatch(): Promise<void> {
    if (this.dispatching) return;
    const exchange = this.config.get<string>('MAIL_EXCHANGE_NAME')?.trim();
    const routingKey = this.config.get<string>('MAIL_ROUTING_KEY')?.trim();
    if (!exchange || !routingKey || !this.rabbit.isConnected) return;

    this.dispatching = true;
    try {
      const now = new Date();
      const claimed = await this.database.transactionWithSession(
        { isPlatform: true },
        async (tx) => {
          const rows = await tx
            .select()
            .from(mailOutbox)
            .where(
              or(
                and(
                  eq(mailOutbox.status, 'pending'),
                  lte(mailOutbox.availableAt, now),
                ),
                and(
                  eq(mailOutbox.status, 'processing'),
                  lte(mailOutbox.lockedUntil, now),
                ),
              ),
            )
            .orderBy(asc(mailOutbox.createdAt))
            .limit(BATCH_SIZE)
            .for('update', { skipLocked: true });

          const lockExpiry = new Date(now.getTime() + CLAIM_DURATION_MS);
          for (const row of rows) {
            await tx
              .update(mailOutbox)
              .set({
                status: 'processing',
                lockedUntil: lockExpiry,
                attempts: row.attempts + 1,
              })
              .where(eq(mailOutbox.id, row.id));
          }
          return rows.map((row) => ({ ...row, attempts: row.attempts + 1 }));
        },
      );

      for (const row of claimed) {
        try {
          const published = await this.rabbit.publish(
            exchange,
            routingKey,
            row.payload,
            { messageId: row.payload.id },
          );
          if (!published)
            throw new Error('RabbitMQ did not confirm the message');
          await this.database.transactionWithSession(
            { isPlatform: true },
            (tx) =>
              tx
                .update(mailOutbox)
                .set({ status: 'sent', sentAt: new Date(), lockedUntil: null })
                .where(eq(mailOutbox.id, row.id)),
          );
        } catch (error) {
          const retryDelayMs = Math.min(60_000, 1_000 * 2 ** row.attempts);
          await this.database.transactionWithSession(
            { isPlatform: true },
            (tx) =>
              tx
                .update(mailOutbox)
                .set({
                  status: 'pending',
                  lockedUntil: null,
                  availableAt: new Date(Date.now() + retryDelayMs),
                  lastError:
                    error instanceof Error
                      ? error.message.slice(0, 500)
                      : 'Unknown publish error',
                })
                .where(eq(mailOutbox.id, row.id)),
          );
          this.logger.warn(
            JSON.stringify({
              event: 'mail.outbox.publish_failed',
              outboxId: row.id,
            }),
          );
        }
      }
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'mail.outbox.dispatch_failed',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      this.dispatching = false;
    }
  }
}
