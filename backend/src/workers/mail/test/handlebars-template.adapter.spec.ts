import { jest } from '@jest/globals';
import { HandlebarsTemplateAdapter } from '../handlebars-template.adapter';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('HandlebarsTemplateAdapter', () => {
  const adapter = new HandlebarsTemplateAdapter();
  const templateDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../templates',
  );

  it('renders the configured HTML template and escapes interpolated values', () => {
    const mail = {
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
