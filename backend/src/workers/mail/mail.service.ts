import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ISendMailOptions, RenderedMail } from '@nestjs-modules/mailer';
import type { Attachment } from 'nodemailer/lib/mailer';
import {
  MAIL_CONFIG,
  MAILER_CLIENT,
  MAIL_TEMPLATE_FILES,
  type MailTemplateName,
} from './mail.constants';
import type { MailRuntimeConfig } from './mail.config';
import { PermanentMailError, type MailJob } from './mail.types';

export interface MailerClient {
  verifyAllTransporters(): Promise<boolean>;
  render(options: ISendMailOptions): Promise<RenderedMail>;
  sendMail(options: ISendMailOptions): Promise<unknown>;
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(MAILER_CLIENT)
    private readonly mailer: MailerClient,
    @Inject(MAIL_CONFIG)
    private readonly config: MailRuntimeConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!(await this.verifyConnection())) {
      this.logger.error(
        JSON.stringify({ event: 'mail.smtp.startup_verification_failed' }),
      );
      throw new ServiceUnavailableException(
        'The configured SMTP transport is unavailable',
      );
    }
    this.logger.log(JSON.stringify({ event: 'mail.smtp.ready' }));
  }

  async verifyConnection(): Promise<boolean> {
    return this.mailer.verifyAllTransporters();
  }

  async send(job: MailJob): Promise<void> {
    const templateFile = getTemplateFile(job.template);
    if (!templateFile) {
      throw new PermanentMailError(
        `Mail template "${job.template}" is not allowed`,
        'UNKNOWN_TEMPLATE',
      );
    }

    validateTemplateUrls(job.template, job.context);
    let rendered;
    try {
      rendered = await this.mailer.render({
        template: templateFile,
        subject: job.subject,
        context: job.context,
      });
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'mail.template.render_failed',
          jobId: job.id,
          template: job.template,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw new PermanentMailError(
        `Mail template "${job.template}" could not be rendered`,
        'TEMPLATE_RENDER_FAILED',
      );
    }
    if (!rendered.html) {
      throw new PermanentMailError(
        `Mail template "${job.template}" produced no HTML`,
        'TEMPLATE_RENDER_EMPTY',
      );
    }

    const sendOptions: ISendMailOptions = {
      to: job.to,
      from: job.from ?? {
        name: this.config.fromName,
        address: this.config.fromEmail,
      },
      replyTo: job.replyTo ?? this.config.replyTo,
      cc: job.cc,
      bcc: job.bcc,
      subject: rendered.subject ?? job.subject,
      html: rendered.html,
      text: job.text ?? rendered.text,
      attachments: (job.attachments ?? []).map(toNodemailerAttachment),
      messageId: job.id,
      headers: {
        'x-correlation-id': job.correlationId ?? job.id,
      },
      priority: mapPriority(job.priority),
    };

    const result = await this.mailer.sendMail(sendOptions);
    if (hasRejectedRecipients(result)) {
      throw new PermanentMailError(
        'The SMTP provider rejected one or more recipients',
        'RECIPIENT_REJECTED',
      );
    }

    this.logger.log(
      JSON.stringify({
        event: 'mail.sent',
        jobId: job.id,
        correlationId: job.correlationId,
        template: job.template,
      }),
    );
  }
}

function getTemplateFile(template: string): string | undefined {
  if (!Object.hasOwn(MAIL_TEMPLATE_FILES, template)) return undefined;
  return MAIL_TEMPLATE_FILES[template as MailTemplateName];
}

function validateTemplateUrls(
  template: MailTemplateName,
  context: Record<string, unknown>,
): void {
  const urlVariables: Partial<Record<MailTemplateName, string[]>> = {
    'user-invitation': ['invitationUrl'],
    'marketing-email': ['ctaUrl', 'unsubscribeUrl'],
  };
  for (const variable of urlVariables[template] ?? []) {
    const value = context[variable];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string') {
      throw new PermanentMailError(
        `Template value "${variable}" must be a URL string`,
        'INVALID_TEMPLATE_URL',
      );
    }
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error();
      }
    } catch {
      throw new PermanentMailError(
        `Template value "${variable}" must use HTTP or HTTPS`,
        'INVALID_TEMPLATE_URL',
      );
    }
  }
}

function toNodemailerAttachment(
  attachment: NonNullable<MailJob['attachments']>[number],
): Attachment {
  return {
    filename: attachment.filename,
    contentType: attachment.contentType,
    content: Buffer.from(attachment.contentBase64, 'base64'),
    ...(attachment.cid
      ? { cid: attachment.cid, contentDisposition: 'inline' }
      : {}),
  };
}

function mapPriority(priority: number | undefined): 'high' | 'normal' | 'low' {
  if (priority !== undefined && priority >= 7) return 'high';
  if (priority !== undefined && priority <= 3) return 'low';
  return 'normal';
}

function hasRejectedRecipients(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'rejected' in value &&
    Array.isArray(value.rejected) &&
    value.rejected.length > 0
  );
}
