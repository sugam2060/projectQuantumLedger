import { Injectable, Logger } from '@nestjs/common';
import { RabbitMQService } from '../../utils/rabbitmq.service';
import { MailService } from './mail.service';

export interface MailWorkerHealth {
  rabbitmq: 'up' | 'down';
  smtp: 'up' | 'down';
}

@Injectable()
export class MailWorkerHealthService {
  private readonly logger = new Logger(MailWorkerHealthService.name);

  constructor(
    private readonly rabbit: RabbitMQService,
    private readonly mailer: MailService,
  ) {}

  async check(): Promise<MailWorkerHealth> {
    let smtp: MailWorkerHealth['smtp'] = 'down';
    try {
      if (await this.mailer.verifyConnection()) smtp = 'up';
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'mail.health.smtp_check_failed',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      smtp = 'down';
    }
    return {
      rabbitmq: this.rabbit.isConnected ? 'up' : 'down',
      smtp,
    };
  }
}
