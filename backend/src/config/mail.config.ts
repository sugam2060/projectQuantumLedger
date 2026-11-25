import { registerAs } from '@nestjs/config';
import { readInt, readString } from './env.util';
import type { MailConfig } from './types';

/**
 * SMTP settings for the email worker. Defaults target a local catcher such as
 * Mailpit (localhost:1025, no auth) so development needs no SMTP account.
 */
export const mailConfig = registerAs('mail', (): MailConfig => ({
  smtpHost: readString('MAIL_HOST') ?? 'localhost',
  smtpPort: readInt('MAIL_PORT', 1025),
  smtpSecure: readString('MAIL_SECURE')?.toLowerCase() === 'true',
  smtpUsername: readString('MAIL_USERNAME'),
  smtpPassword: readString('MAIL_PASSWORD'),
  fromName: readString('MAIL_FROM_NAME') ?? 'Fortis',
  fromEmail: readString('MAIL_FROM_EMAIL') ?? 'no-reply@fortis.local',
  replyTo: readString('MAIL_REPLY_TO'),
  workersEnabled: readString('JOBS_WORKERS_ENABLED')?.toLowerCase() !== 'false',
}));
