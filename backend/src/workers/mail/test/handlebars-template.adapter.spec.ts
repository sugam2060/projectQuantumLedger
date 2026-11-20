import { jest } from '@jest/globals';
import { HandlebarsTemplateAdapter } from '../handlebars-template.adapter';
import { resolve } from 'node:path';

describe('HandlebarsTemplateAdapter', () => {
  const adapter = new HandlebarsTemplateAdapter();
  const templateDirectory = resolve(
    process.cwd(),
    'src/workers/mail/templates',
  );

  it('renders the configured HTML template and escapes interpolated values', () => {
    const mail: {
      data: {
        template: string;
        context: Record<string, unknown>;
        html?: string;
      };
    } = {
      data: {
        template: 'otp-verification.html',
        context: { code: '<img src=x>', expiresInMinutes: 5 },
      },
    };
    const options = {
      template: { dir: templateDirectory, options: { strict: true } },
    };
    const callback = jest.fn();

    adapter.compile(mail, callback, options);

    expect(callback).toHaveBeenCalledWith();
    expect(mail.data.html).toContain('&lt;img src&#x3D;x&gt;');
  });

  it('renders branch details and terminal activation codes in the branch email', () => {
    const mail: {
      data: {
        template: string;
        context: Record<string, unknown>;
        html?: string;
      };
    } = {
      data: {
        template: 'branch-created.html',
        context: {
          homeUrl: '#',
          businessName: 'Example Retail',
          businessId: 'business-id',
          branchName: 'Downtown',
          branchId: 'branch-id',
          branchCode: 'DOWNTOWN',
          address: '<unsafe address>',
          contactNumber: '+9779800000000',
          terminals: [
            {
              id: 'terminal-id',
              name: 'Front Counter',
              terminalCode: 'POS-A1B2C3D4E5F60718',
            },
          ],
        },
      },
    };
    const options = {
      template: { dir: templateDirectory, options: { strict: true } },
    };
    const callback = jest.fn();

    adapter.compile(mail, callback, options);

    expect(callback).toHaveBeenCalledWith();
    expect(mail.data.html).toContain('Downtown');
    expect(mail.data.html).toContain('business-id');
    expect(mail.data.html).toContain('POS-A1B2C3D4E5F60718');
    expect(mail.data.html).toContain('&lt;unsafe address&gt;');
  });

  it('reports missing templates through the adapter callback', () => {
    const mail = { data: { template: 'missing.html', context: {} } };
    const options = { template: { dir: templateDirectory } };
    const callback = jest.fn();

    adapter.compile(mail, callback, options);

    expect(callback).toHaveBeenCalledWith(expect.any(Error));
  });

  it('rejects template paths outside the configured directory', () => {
    const mail = {
      data: { template: '../mail.service.ts', context: {} },
    };
    const options = { template: { dir: templateDirectory } };
    const callback = jest.fn();

    adapter.compile(mail, callback, options);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('outside') }),
    );
  });
});
