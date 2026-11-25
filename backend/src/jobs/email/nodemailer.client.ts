import type { Transporter } from 'nodemailer';
import type { SendMailOptions } from 'nodemailer';
import type {
  MailerClient,
  RenderRequest,
  RenderedMail,
} from './mailer.service';
import { htmlToText, type TemplateRenderer } from './template-renderer';

/** `MailerClient` over a nodemailer SMTP transport and Handlebars templates. */
export class NodemailerClient implements MailerClient {
  constructor(
    private readonly transporter: Transporter,
    private readonly renderer: TemplateRenderer,
  ) {}

  async verifyAllTransporters(): Promise<boolean> {
    try {
      return await this.transporter.verify();
    } catch {
      return false;
    }
  }

  render(request: RenderRequest): Promise<RenderedMail> {
    const html = this.renderer.render(request.template, request.context);
    return Promise.resolve({
      html,
      text: htmlToText(html),
      subject: request.subject,
    });
  }

  sendMail(options: SendMailOptions): Promise<unknown> {
    return this.transporter.sendMail(options);
  }
}
