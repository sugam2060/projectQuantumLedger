/** Allowed templates and their files in `templates/`. Jobs may only name these. */
export const MAIL_TEMPLATE_FILES = {
  'otp-verification': 'otp-verification.html',
  'user-invitation': 'user-invitation.html',
  'redeem-code': 'redeem-code.html',
  'branch-created': 'branch-created.html',
  'marketing-email': 'marketing-email.html',
  'password-reset': 'password-reset.html',
} as const;

export type MailTemplateName = keyof typeof MAIL_TEMPLATE_FILES;

/** Context variables that are rendered into links and must be http(s) URLs. */
export const TEMPLATE_URL_VARIABLES: Partial<
  Record<MailTemplateName, readonly string[]>
> = {
  'user-invitation': ['invitationUrl'],
  'marketing-email': ['ctaUrl', 'unsubscribeUrl'],
  'password-reset': ['resetUrl'],
};

/** The template file for a name, or undefined when the name is not allowed. */
export function getTemplateFile(template: string): string | undefined {
  if (!Object.hasOwn(MAIL_TEMPLATE_FILES, template)) return undefined;
  return MAIL_TEMPLATE_FILES[template as MailTemplateName];
}
