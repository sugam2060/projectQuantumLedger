import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { UnauthorizedException } from '@nestjs/common';
import type { AuthConfig } from '../../config';
import { AuthenticationService } from '../authentication.service';
import { ClientType } from '../dto/client-login.dto';
import type { AuthMetadata } from '../types';

const USER = '00000000-0000-4000-8000-000000000001';
const BUSINESS = '00000000-0000-4000-8000-000000000002';
const BRANCH = '00000000-0000-4000-8000-000000000003';
const TERMINAL = '00000000-0000-4000-8000-000000000004';
const TOKEN = 'a'.repeat(43);

const config: AuthConfig = {
  jwtSecret: 'x'.repeat(32),
  accessTtl: '15m',
  accessTtlSeconds: 900,
  issuer: 'i',
  audience: 'a',
  platformAudience: 'p',
  refreshPersistentTtlSeconds: 1000,
  refreshSessionTtlSeconds: 100,
  passwordResetTtlMinutes: 30,
};

const meta = (overrides: Partial<AuthMetadata> = {}): AuthMetadata => ({
  clientType: ClientType.DESKTOP,
  terminalId: TERMINAL,
  audit: {},
  ...overrides,
});

const membership = {
  membershipId: 'm1',
  businessId: BUSINESS,
  branchId: null,
  isOwner: true,
  roleId: null,
  roleName: null,
  roleVersion: null,
};

function setup() {
  const repository = {
    findCredentialByEmail: jest.fn().mockResolvedValue({
      id: USER,
      email: 'owner@fortis.test',
      name: 'Owner',
      passwordHash: 'stored',
      status: 'active',
    }),
    findAccount: jest.fn().mockResolvedValue({
      id: USER,
      email: 'owner@fortis.test',
      name: 'Owner',
      status: 'active',
    }),
    listActiveMemberships: jest.fn().mockResolvedValue([membership]),
    findActiveTerminal: jest.fn().mockResolvedValue({
      id: TERMINAL,
      businessId: BUSINESS,
      branchId: BRANCH,
    }),
    updatePasswordHash: jest.fn().mockResolvedValue(undefined),
  };
  const sessions = {
    create: jest.fn().mockResolvedValue('session-1'),
    rotate: jest.fn(),
    revoke: jest.fn().mockResolvedValue(true),
    revokeAll: jest.fn().mockResolvedValue(3),
  };
  const passwords = {
    verify: jest.fn().mockResolvedValue({ valid: true, needsRehash: false }),
    verifyAgainstDummy: jest.fn().mockResolvedValue(false),
    hash: jest.fn().mockResolvedValue('new-hash'),
  };
  const tokens = {
    signUserToken: jest.fn().mockResolvedValue({
      token: 'jwt',
      expiresIn: '15m',
      expiresInSeconds: 900,
    }),
  };
  const effective = { resolve: jest.fn().mockResolvedValue(null) };
  const audit = {
    logUserEvent: jest.fn().mockResolvedValue(undefined),
    insertUserEvent: jest.fn(),
  };
  const passwordsRepository = {
    currentHash: jest.fn().mockResolvedValue('stored'),
  };
  const service = new AuthenticationService(
    repository as never,
    sessions as never,
    passwordsRepository as never,
    passwords as never,
    tokens as never,
    effective as never,
    audit as never,
    config,
  );
  return {
    service,
    repository,
    sessions,
    passwordsRepository,
    passwords,
    tokens,
    audit,
  };
}

describe('AuthenticationService.login', () => {
  it('signs in, binds the terminal branch and stores only the token hash', async () => {
    const { service, sessions, tokens } = setup();
    const result = await service.login(
      { email: ' Owner@Fortis.Test ', password: 'pw', remember: true },
      meta(),
    );

    expect(tokens.signUserToken).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: USER,
        businessId: BUSINESS,
        branchId: BRANCH,
        terminalId: TERMINAL,
        isOwner: true,
      }),
    );
    const [actor, session] = sessions.create.mock.calls[0];
    expect(actor).toEqual({ userId: USER });
    expect(session).toMatchObject({ persistent: true, terminalId: TERMINAL });
    expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.tokenHash).not.toBe(result.refreshToken);
    expect(result.refreshMaxAgeMs).toBe(1_000_000);
  });

  it('uses a browser-session cookie lifetime when not remembered', async () => {
    const { service } = setup();
    const result = await service.login(
      { email: 'o@f.t', password: 'pw', remember: false },
      meta({ clientType: ClientType.WEB, terminalId: undefined }),
    );
    expect(result.refreshMaxAgeMs).toBeUndefined();
  });

  it('spends a dummy verification and returns the generic 401 for unknown email', async () => {
    const { service, repository, passwords, sessions } = setup();
    repository.findCredentialByEmail.mockResolvedValue(null);
    await expect(
      service.login(
        { email: 'x@y.z', password: 'pw', remember: false },
        meta(),
      ),
    ).rejects.toThrow('Invalid email or password');
    expect(passwords.verifyAgainstDummy).toHaveBeenCalled();
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong password', { valid: false, needsRehash: false }, 'active'],
    ['disabled account', { valid: true, needsRehash: false }, 'disabled'],
  ])('returns the same 401 for a %s', async (_case, check, status) => {
    const { service, repository, passwords, audit } = setup();
    passwords.verify.mockResolvedValue(check);
    repository.findCredentialByEmail.mockResolvedValue({
      id: USER,
      email: 'o@f.t',
      name: 'O',
      passwordHash: 'h',
      status,
    });
    await expect(
      service.login(
        { email: 'o@f.t', password: 'pw', remember: false },
        meta(),
      ),
    ).rejects.toThrow('Invalid email or password');
    expect(audit.logUserEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'USER_LOGIN_FAILED' }),
    );
  });

  it('upgrades a legacy hash after a successful sign-in', async () => {
    const { service, passwords, repository } = setup();
    passwords.verify.mockResolvedValue({ valid: true, needsRehash: true });
    await service.login(
      { email: 'o@f.t', password: 'pw', remember: false },
      meta(),
    );
    expect(repository.updatePasswordHash).toHaveBeenCalledWith(
      USER,
      'new-hash',
    );
  });

  it('rejects a terminal outside the membership business', async () => {
    const { service, repository } = setup();
    repository.findActiveTerminal.mockResolvedValue({
      id: TERMINAL,
      businessId: '00000000-0000-4000-8000-0000000000ff',
      branchId: BRANCH,
    });
    await expect(
      service.login(
        { email: 'o@f.t', password: 'pw', remember: false },
        meta(),
      ),
    ).rejects.toThrow('No active business membership');
  });
});

describe('AuthenticationService.refresh', () => {
  it('rejects malformed tokens without touching the database', async () => {
    const { service, sessions } = setup();
    await expect(service.refresh('nope', meta())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(sessions.rotate).not.toHaveBeenCalled();
  });

  it('audits reuse and answers 401', async () => {
    const { service, sessions, audit } = setup();
    sessions.rotate.mockResolvedValue({ outcome: 'reuse', userId: USER });
    await expect(service.refresh(TOKEN, meta())).rejects.toThrow(
      'Invalid refresh token',
    );
    expect(audit.logUserEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'USER_REFRESH_TOKEN_REUSE_DETECTED',
      }),
    );
  });

  it('revokes the freshly rotated session when the terminal does not match', async () => {
    const { service, sessions } = setup();
    sessions.rotate.mockResolvedValue({
      outcome: 'rotated',
      userId: USER,
      terminalId: '00000000-0000-4000-8000-0000000000aa',
      persistent: false,
    });
    await expect(service.refresh(TOKEN, meta())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(sessions.revoke).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
  });

  it('revokes the new session when a platform session is replayed here', async () => {
    const { service, sessions } = setup();
    sessions.rotate.mockResolvedValue({
      outcome: 'rotated',
      userId: null,
      platformUserId: USER,
    });
    await expect(service.refresh(TOKEN, meta())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(sessions.revoke).toHaveBeenCalled();
  });

  it('issues a new pair for a valid rotation', async () => {
    const { service, sessions } = setup();
    sessions.rotate.mockResolvedValue({
      outcome: 'rotated',
      userId: USER,
      terminalId: TERMINAL,
      persistent: true,
    });
    const result = await service.refresh(TOKEN, meta());
    expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.refreshToken).not.toBe(TOKEN);
    expect(result.refreshMaxAgeMs).toBe(1_000_000);
  });
});

describe('AuthenticationService logout', () => {
  it('ignores malformed tokens and revokes well-formed ones by hash', async () => {
    const { service, sessions } = setup();
    await service.logout(undefined);
    await service.logout('short');
    expect(sessions.revoke).not.toHaveBeenCalled();
    await service.logout(TOKEN);
    expect(sessions.revoke).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
  });

  it('revokes all sessions of the signed-in user', async () => {
    const { service, sessions } = setup();
    await expect(
      service.logoutAll({ subjectId: USER, userId: USER, permissions: [] }),
    ).resolves.toEqual({ revoked: 3 });
    expect(sessions.revokeAll).toHaveBeenCalledWith({ userId: USER });
  });
});
