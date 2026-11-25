import { Module } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { join, resolve } from 'node:path';
import { createTransport } from 'nodemailer';
import { mailConfig } from '../../config';
import { EmailProcessor } from './email.processor';
import { EmailSenderService } from './mailer.service';
import { NodemailerClient } from './nodemailer.client';
import { TemplateRenderer } from './template-renderer';
import { MAILER_CLIENT } from './types';

/**
 * Built output keeps the templates next to this file (nest-cli copies *.html).
 * Under Jest's ESM mode `__dirname` does not exist, so fall back to the source tree.
 */
function templateDirectory(): string {
  return typeof __dirname === 'string'
    ? join(__dirname, 'templates')
    : resolve(process.cwd(), 'src', 'jobs', 'email', 'templates');
}

/**
 * The consuming side of the email queue: SMTP transport, template rendering and
 * the BullMQ worker. Loaded only when JOBS_WORKERS_ENABLED is not "false".
 */
@Module({
  imports: [ConfigModule.forFeature(mailConfig)],
  providers: [
    {
      provide: MAILER_CLIENT,
      inject: [mailConfig.KEY],
      useFactory: (mail: ConfigType<typeof mailConfig>) =>
        new NodemailerClient(
          createTransport({
            host: mail.smtpHost,
            port: mail.smtpPort,
            secure: mail.smtpSecure,
            ...(mail.smtpUsername
              ? { auth: { user: mail.smtpUsername, pass: mail.smtpPassword } }
              : {}),
          }),
          new TemplateRenderer(templateDirectory()),
        ),
    },
    EmailSenderService,
    EmailProcessor,
  ],
})
export class EmailWorkerModule {}
