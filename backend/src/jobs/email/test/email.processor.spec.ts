import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { PermanentMailError } from '../email.errors';
import { EmailProcessor } from '../email.processor';
import { EmailProducer } from '../email.producer';
import type { EmailSenderService } from '../mailer.service';
import { SEND_EMAIL_JOB, type MailJob } from '../types';

const validJob = (overrides: Partial<MailJob> = {}): MailJob => ({
  id: 'mail-1',
  to: 'owner@example.com',
  subject: 'Hello',
  template: 'redeem-code',
  context: { redeemCode: 'ABC' },
  createdAt: '2026-11-25T00:00:00.000Z',
  ...overrides,
});

const asJob = (data: unknown): Job<unknown> =>
  ({ id: 'job-1', data, attemptsMade: 0 }) as unknown as Job<unknown>;

describe('EmailProcessor', () => {
  const sender = { send: jest.fn() };
  const processor = new EmailProcessor(sender as unknown as EmailSenderService);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('sends a valid job', async () => {
    sender.send.mockResolvedValue(undefined);
    await processor.process(asJob(validJob()));
    expect(sender.send).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mail-1', template: 'redeem-code' }),
    );
  });

  it.each([
    ['unknown template', { template: 'phishing' }],
    ['header injection in subject', { subject: 'Hi\r\nBcc: x@y.z' }],
    ['bad recipient', { to: 'not-an-email' }],
  ])(
    'marks a payload with %s unrecoverable without sending',
    async (_c, bad) => {
      await expect(
        processor.process(asJob({ ...validJob(), ...bad })),
      ).rejects.toBeInstanceOf(UnrecoverableError);
      expect(sender.send).not.toHaveBeenCalled();
    },
  );

  it('rejects unexpected fields', async () => {
    await expect(
      processor.process(asJob({ ...validJob(), extra: 'x' })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('does not retry a permanent mail failure', async () => {
    sender.send.mockRejectedValue(
      new PermanentMailError('rejected', 'RECIPIENT_REJECTED'),
    );
    await expect(processor.process(asJob(validJob()))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('rethrows transient failures so BullMQ retries them', async () => {
    const transient = new Error('SMTP timeout');
    sender.send.mockRejectedValue(transient);
    await expect(processor.process(asJob(validJob()))).rejects.toBe(transient);
  });
});

describe('EmailProducer', () => {
  it('enqueues with the mail id as job id so duplicates send once', async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const producer = new EmailProducer(queue as never);

    await producer.send(validJob({ priority: 8 }));

    expect(queue.add).toHaveBeenCalledWith(
      SEND_EMAIL_JOB,
      expect.objectContaining({ id: 'mail-1' }),
      { jobId: 'mail-1', priority: 2 },
    );
  });
});
