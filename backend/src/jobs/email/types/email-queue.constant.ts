/** BullMQ queue that delivers transactional email. */
export const EMAIL_QUEUE = 'email';

/** Job name for "render this template and send it". */
export const SEND_EMAIL_JOB = 'send';

/** DI token for the SMTP + template client (`NodemailerClient`). */
export const MAILER_CLIENT = Symbol('MAILER_CLIENT');

/** Retry policy for email jobs: 5 attempts, exponential backoff from 2 s. */
export const EMAIL_JOB_ATTEMPTS = 5;
export const EMAIL_JOB_BACKOFF_MS = 2_000;
