import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { SendMailOptions } from 'nodemailer';
import type { Attachment } from 'nodemailer/lib/mailer';
import { mailConfig } from '../../config';
import { PermanentMailError } from './email.errors';
import {
  getTemplateFile,
  TEMPLATE_URL_VARIABLES,
  type MailTemplateName,
} from './email-templates';
import { MAILER_CLIENT, type MailJob } from './types';

/** What to render: a template file from `templates/`, its subject and variables. */
export type RenderRequest = {
  template: string;
  subject: string;
  context: Record<string, unknown>;
};

export type RenderedMail = {
  html?: string;
  text?: string;
  subject?: string;
};

/** Transport + rendering seam, so the sender can be tested without SMTP. */
export interface MailerClient {
  verifyAllTransporters(): Promise<boolean>;
  render(request: RenderRequest): Promise<RenderedMail>;
  sendMail(options: SendMailOptions): Promise<unknown>;
}

/**
 * Renders an allowed template and sends it over SMTP. Throws `PermanentMailError`
 * for failures that a retry cannot fix; any other error is retried by the queue.
 */
@Injectable()
export class EmailSenderService implements OnModuleInit {
  private readonly logger = new Logger(EmailSenderService.name);

  constructor(
    @Inject(MAILER_CLIENT)
    private readonly mailer: MailerClient,
    @Inject(mailConfig.KEY)
    private readonly config: ConfigType<typeof mailConfig>,
  ) {}

  /** Checks SMTP at startup. A failure is logged, not fatal: jobs retry later. */
  async onModuleInit(): Promise<void> {
    const ready = await this.verifyConnection().catch(() => false);
    if (ready) {
      this.logger.log(JSON.stringify({ event: 'mail.smtp.ready' }));
    } else {
      this.logger.error(
        JSON.stringify({ event: 'mail.smtp.startup_verification_failed' }),
      );
    }
  }

  verifyConnection(): Promise<boolean> {
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
    let rendered: RenderedMail;
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

    const sendOptions: SendMailOptions = {
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

function validateTemplateUrls(
  template: MailTemplateName,
  context: Record<string, unknown>,
): void {
  for (const variable of TEMPLATE_URL_VARIABLES[template] ?? []) {
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
