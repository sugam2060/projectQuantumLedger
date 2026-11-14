export const MAIL_CONFIG = Symbol('MAIL_CONFIG');
export const MAILER_CLIENT = Symbol('MAILER_CLIENT');
export const MAIL_CONSUMER_ID = 'mail-worker';
export const MAIL_RETRY_COUNT_HEADER = 'x-mail-retry-count';

export const MAIL_TEMPLATE_FILES = {
  'otp-verification': 'otp-verification.html',
  'user-invitation': 'user-invitation.html',
  'redeem-code': 'redeem-code.html',
  'marketing-email': 'marketing-email.html',
} as const;

export type MailTemplateName = keyof typeof MAIL_TEMPLATE_FILES;
