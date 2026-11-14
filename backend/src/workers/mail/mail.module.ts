import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { MailerService } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { join } from 'node:path';
import { UtilsModule } from '../../utils/utils.module';
import { MAIL_CONFIG, MAILER_CLIENT } from './mail.constants';
import { createMailRuntimeConfig, type MailRuntimeConfig } from './mail.config';
import { MailProcessor } from './processors/mail.processor';
import { MailDlqMonitor } from './processors/mail-dlq.monitor';
import { MailService } from './mail.service';
import { MailWorkerHealthService } from './mail-worker-health.service';

@Module({
  imports: [
    ConfigModule,
    UtilsModule,
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const mail = createMailRuntimeConfig(config);
        return {
          transport: {
            host: mail.smtpHost,
            port: mail.smtpPort,
            secure: mail.smtpSecure,
            auth: {
              user: mail.smtpUsername,
              pass: mail.smtpPassword,
            },
          },
          defaults: {
            from: { name: mail.fromName, address: mail.fromEmail },
            ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
          },
          template: {
            dir: join(__dirname, 'templates'),
            adapter: new HandlebarsAdapter(),
            options: { strict: true },
          },
          retry: false,
          verifyTransporters: false,
          textFromHtml: true,
        };
      },
    }),
  ],
  providers: [
    {
      provide: MAIL_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MailRuntimeConfig =>
        createMailRuntimeConfig(config),
    },
    { provide: MAILER_CLIENT, useExisting: MailerService },
    MailService,
    MailProcessor,
    MailDlqMonitor,
    MailWorkerHealthService,
  ],
  exports: [MailService, MailWorkerHealthService],
})
export class MailModule {}
