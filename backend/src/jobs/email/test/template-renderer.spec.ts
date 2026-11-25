import { resolve } from 'node:path';
import { htmlToText, TemplateRenderer } from '../template-renderer';

describe('TemplateRenderer', () => {
  const renderer = new TemplateRenderer(
    resolve(process.cwd(), 'src/jobs/email/templates'),
  );

  it('renders the configured HTML template and escapes interpolated values', () => {
    const html = renderer.render('otp-verification.html', {
      code: '<img src=x>',
      expiresInMinutes: 5,
    });
    expect(html).toContain('&lt;img src&#x3D;x&gt;');
  });

  it('renders branch details and terminal activation codes in the branch email', () => {
    const html = renderer.render('branch-created.html', {
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
    });
    expect(html).toContain('Downtown');
    expect(html).toContain('business-id');
    expect(html).toContain('POS-A1B2C3D4E5F60718');
    expect(html).toContain('&lt;unsafe address&gt;');
  });

  it('throws for a missing template', () => {
    expect(() => renderer.render('missing.html', {})).toThrow();
  });

  it('rejects template paths outside the configured directory', () => {
    expect(() => renderer.render('../mailer.service.ts', {})).toThrow(
      'outside',
    );
  });

  it('fails in strict mode when a variable is missing', () => {
    expect(() => renderer.render('otp-verification.html', {})).toThrow();
  });
});

describe('htmlToText', () => {
  it('strips markup and decodes entities', () => {
    expect(
      htmlToText(
        '<style>p{}</style><h1>Hello</h1><p>Code: <b>1&amp;2</b></p><br>&lt;ok&gt;',
      ),
    ).toBe('Hello\nCode: 1&2\n<ok>');
  });
});
