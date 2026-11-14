import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { RabbitMQService } from '../../../utils/rabbitmq.service';
import { MAIL_CONFIG } from '../mail.constants';
import type { MailRuntimeConfig } from '../mail.config';

@Injectable()
export class MailDlqMonitor implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MailDlqMonitor.name);
  private timer?: NodeJS.Timeout;
  private checking = false;

  constructor(
    private readonly rabbit: RabbitMQService,
    @Inject(MAIL_CONFIG)
    private readonly config: MailRuntimeConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.dlqEnabled) return;
    this.timer = setInterval(
      () => void this.checkNow(),
      this.config.dlqCheckIntervalMs,
    );
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async checkNow(): Promise<void> {
    if (!this.config.dlqEnabled || this.checking) return;
    this.checking = true;
    try {
      const { messageCount, consumerCount } = await this.rabbit.getQueueStats(
        this.config.dlqQueue,
      );
      if (messageCount > 0) {
        this.logger.warn(
          JSON.stringify({
            event: 'mail.dead_letter_queue.non_empty',
            queue: this.config.dlqQueue,
            messageCount,
            consumerCount,
          }),
        );
      }
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'mail.dead_letter_queue.monitor_failed',
          queue: this.config.dlqQueue,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      this.checking = false;
    }
  }
}
