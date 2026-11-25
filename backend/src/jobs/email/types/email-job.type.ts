import type { MailTemplateName } from '../email-templates';

/** A file attached to an email, base64 encoded so the job stays JSON. */
export type MailAttachment = {
  filename: string;
  contentType: string;
  contentBase64: string;
  cid?: string;
};

/**
 * Payload of one `email` queue job. `id` doubles as the BullMQ job id, so enqueuing
 * the same id twice sends one email.
 */
export type MailJob = {
  id: string;
  to: string | string[];
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  template: MailTemplateName;
  context: Record<string, unknown>;
  text?: string;
  attachments?: MailAttachment[];
  /** 0-9; >= 7 sends with high priority, <= 3 low. */
  priority?: number;
  correlationId?: string;
  createdAt: string;
};
