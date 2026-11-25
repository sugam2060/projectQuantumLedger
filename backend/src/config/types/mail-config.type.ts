/** Shape of the `mail` config namespace (see `mail.config.ts`). */
export type MailConfig = {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string | undefined;
  smtpPassword: string | undefined;
  fromName: string;
  fromEmail: string;
  replyTo: string | undefined;
  /** When false this process enqueues email but does not run the email worker. */
  workersEnabled: boolean;
};
