import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { ServiceUnavailableException } from '@nestjs/common';
import type { MailRuntimeConfig } from './mail.config';
import { MailService, type MailerClient } from './mail.service';
import { PermanentMailError, type MailJob } from './mail.types';

describe('MailService', () => {
  const config: MailRuntimeConfig = {
    smtpHost: 'smtp.example.test',
    smtpPort: 587,
    smtpSecure: false,
    smtpUsername: 'worker',
    smtpPassword: 'not-a-real-password',
    fromName: 'Example',
    fromEmail: 'no-reply@example.test',
    queueName: 'mail',
    exchangeName: 'mail',
    routingKey: 'mail.send',
    workerConcurrency: 2,
    prefetchCount: 2,
    maxRetries: 3,
    retryInitialDelayMs: 1000,
    retryMaxDelayMs: 8000,
    dlqEnabled: true,
    dlqExchange: 'mail.dlx',
    dlqQueue: 'mail.dlq',
    dlqRoutingKey: 'mail.failed',
    dlqCheckIntervalMs: 10000,
    idempotencyTtlSeconds: 86400,
    idempotencyLockTtlSeconds: 120,
    maxAttachmentSizeBytes: 1024,
  };
  let mailer: {
    verifyAllTransporters: jest.Mock;
    render: jest.Mock;
    sendMail: jest.Mock;
  };
  let service: MailService;

  beforeEach(() => {
    mailer = {
      verifyAllTransporters: jest.fn().mockResolvedValue(true),
      render: jest.fn().mockResolvedValue({
        html: '<p>Rendered</p>',
        text: 'Rendered',
        subject: 'Rendered subject',
      }),
      sendMail: jest
        .fn()
        .mockResolvedValue({ accepted: ['user@example.test'] }),
    };
    service = new MailService(mailer as unknown as MailerClient, config);
  });

  it('fails worker startup when the SMTP transport is unavailable', async () => {
    mailer.verifyAllTransporters.mockResolvedValue(false);

    await expect(service.onModuleInit()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('renders only an allowlisted template and maps attachments and metadata', async () => {
    const job = validJob({
      attachments: [
        {
          filename: 'report.txt',
          contentType: 'text/plain',
          contentBase64: Buffer.from('report').toString('base64'),
        },
      ],
    });

    await service.send(job);

    expect(mailer.render).toHaveBeenCalledWith({
      template: 'otp-verification.html',
      subject: 'A verification code',
      context: { code: '123456', expiresInMinutes: 10 },
    });
    expect(mailer.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.test',
        from: { name: 'Example', address: 'no-reply@example.test' },
        subject: 'Rendered subject',
        html: '<p>Rendered</p>',
        messageId: job.id,
        headers: { 'x-correlation-id': 'correlation-1' },
        attachments: [
          expect.objectContaining({
            filename: 'report.txt',
            content: Buffer.from('report'),
          }),
        ],
      }),
    );
  });

  it('rejects unsafe template URLs before rendering', async () => {
    const job = validJob({
      template: 'user-invitation',
      context: { invitationUrl: 'javascript:alert(1)' },
    });

    await expect(service.send(job)).rejects.toBeInstanceOf(PermanentMailError);
    expect(mailer.render).not.toHaveBeenCalled();
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it('treats a provider partial-recipient rejection as permanent', async () => {
    mailer.sendMail.mockResolvedValue({
      accepted: ['one@example.test'],
      rejected: ['two@example.test'],
    });

    await expect(service.send(validJob())).rejects.toMatchObject({
      code: 'RECIPIENT_REJECTED',
      permanent: true,
    });
  });
});

function validJob(overrides: Partial<MailJob> = {}): MailJob {
  return {
    id: 'mail-job-1',
    to: 'user@example.test',
    subject: 'A verification code',
    template: 'otp-verification',
    context: { code: '123456', expiresInMinutes: 10 },
    createdAt: new Date().toISOString(),
    correlationId: 'correlation-1',
    ...overrides,
  };
}
