import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, lte, or } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { mailOutbox } from '../database/schemas';
import { RabbitMQService } from '../utils/rabbitmq.service';

const CLAIM_DURATION_MS = 60_000;
const RECOVERY_INTERVAL_MS = 60_000;
const BATCH_SIZE = 20;

@Injectable()
export class MailOutboxPublisher
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(MailOutboxPublisher.name);
  private recoveryTimer?: NodeJS.Timeout;
  private dispatchTimer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private retryDeadlines: number[] = [];
  private retryTimerDueAt?: number;
  private dispatching = false;
  private dispatchRequested = false;
  private shuttingDown = false;
  private unsubscribeFromRabbit?: () => void;

  constructor(
    private readonly database: DatabaseService,
    private readonly rabbit: RabbitMQService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.unsubscribeFromRabbit = this.rabbit.onConnected(() =>
      this.notifyOutboxAvailable(),
    );
    this.recoveryTimer = setInterval(
      () => void this.dispatch(),
      RECOVERY_INTERVAL_MS,
    );
    this.recoveryTimer.unref();
    this.notifyOutboxAvailable();
  }

  onApplicationShutdown(): void {
    this.shuttingDown = true;
    this.unsubscribeFromRabbit?.();
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    if (this.dispatchTimer) clearTimeout(this.dispatchTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  notifyOutboxAvailable(): void {
    if (this.shuttingDown) return;
    if (this.dispatchTimer) clearTimeout(this.dispatchTimer);
    this.dispatchTimer = setTimeout(() => {
      this.dispatchTimer = undefined;
      void this.dispatch();
    }, 0);
    this.dispatchTimer.unref();
  }

  async dispatch(): Promise<void> {
    if (this.dispatching) {
      this.dispatchRequested = true;
      return;
    }
    if (this.shuttingDown) return;
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
          this.scheduleRetry(retryDelayMs);
        }
      }
      if (claimed.length === BATCH_SIZE) this.notifyOutboxAvailable();
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'mail.outbox.dispatch_failed',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      this.dispatching = false;
      if (this.dispatchRequested && !this.shuttingDown) {
        this.dispatchRequested = false;
        this.notifyOutboxAvailable();
      }
    }
  }

  private scheduleRetry(delayMs: number): void {
    this.retryDeadlines.push(Date.now() + delayMs);
    this.retryDeadlines.sort((left, right) => left - right);
    this.scheduleNextRetry();
  }

  private scheduleNextRetry(): void {
    const nextDueAt = this.retryDeadlines[0];
    if (nextDueAt === undefined || this.shuttingDown) return;
    if (this.retryTimer && this.retryTimerDueAt! <= nextDueAt) return;

    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimerDueAt = nextDueAt;
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = undefined;
        this.retryTimerDueAt = undefined;
        const now = Date.now();
        this.retryDeadlines = this.retryDeadlines.filter(
          (dueAt) => dueAt > now,
        );
        this.notifyOutboxAvailable();
        this.scheduleNextRetry();
      },
      Math.max(0, nextDueAt - Date.now()),
    );
    this.retryTimer.unref();
  }
}
