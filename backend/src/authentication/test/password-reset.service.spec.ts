import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { BadRequestException, Logger } from '@nestjs/common';
import type { AppConfig, AuthConfig } from '../../config';
import { PasswordResetService } from '../password-reset.service';

const auth = { passwordResetTtlMinutes: 30 } as AuthConfig;
const app = (frontendBaseUrl: string | undefined) =>
  ({ frontendBaseUrl }) as AppConfig;

function setup(frontend: string | undefined = 'https://app.fortis.test/') {
  const repository = {
    createResetToken: jest.fn().mockResolvedValue({
      id: 'user-1',
      email: 'owner@fortis.test',
      name: 'Owner',
    }),
    consumeResetToken: jest.fn().mockResolvedValue('user-1'),
  };
  const passwords = { hash: jest.fn().mockResolvedValue('argon-hash') };
  const email = { send: jest.fn().mockResolvedValue(undefined) };
  const audit = {
    logUserEvent: jest.fn().mockResolvedValue(undefined),
    logPlatformEvent: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PasswordResetService(
    repository as never,
    passwords as never,
    email as never,
    audit as never,
    auth,
    app(frontend),
  );
  return { service, repository, email, audit };
}

describe('PasswordResetService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('stores only the token hash and emails a link with the raw token', async () => {
    const { service, repository, email } = setup();
    await service.requestReset('user', 'owner@fortis.test');

    const stored = repository.createResetToken.mock.calls[0][0];
    expect(stored).toMatchObject({ actor: 'user', email: 'owner@fortis.test' });
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    const job = email.send.mock.calls[0][0];
    const url = new URL(String(job.context.resetUrl));
    expect(url.origin + url.pathname).toBe(
      'https://app.fortis.test/reset-password',
    );
    const token = url.searchParams.get('token');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toBe(stored.tokenHash);
    expect(job).toMatchObject({
      template: 'password-reset',
      to: 'owner@fortis.test',
    });
  });

  it('sends nothing (and does not fail) for an unknown account', async () => {
    const { service, repository, email } = setup();
    repository.createResetToken.mockResolvedValue(null);
    await expect(
      service.requestReset('user', 'x@y.z'),
    ).resolves.toBeUndefined();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('swallows queue failures so the response stays the same', async () => {
    const { service, email } = setup();
    email.send.mockRejectedValue(new Error('redis down'));
    await expect(
      service.requestReset('platform', 'staff@fortis.test'),
    ).resolves.toBeUndefined();
  });

  it('does not email without a configured website origin', async () => {
    const { service, email } = setup('');
    await service.requestReset('user', 'owner@fortis.test');
    expect(email.send).not.toHaveBeenCalled();
  });

  it('rejects an unusable token with one generic 400', async () => {
    const { service, repository } = setup();
    repository.consumeResetToken.mockResolvedValue(null);
    await expect(
      service.reset('user', 'a'.repeat(43), 'New-Password-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hashes the new password before it reaches the database and audits', async () => {
    const { service, repository, audit } = setup();
    await service.reset('user', 'a'.repeat(43), 'New-Password-1');
    expect(repository.consumeResetToken).toHaveBeenCalledWith({
      actor: 'user',
      tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      passwordHash: 'argon-hash',
    });
    expect(audit.logUserEvent).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({ eventType: 'USER_PASSWORD_RESET' }),
    );
  });
});
