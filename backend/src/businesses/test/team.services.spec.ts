import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { hashOpaqueToken } from '../../common/utils/opaque-token.util';
import { InvitationsService } from '../invitations.service';
import { MembersService } from '../members.service';
import { MyInvitationsService } from '../my-invitations.service';
import { RolesService } from '../roles.service';
import { assertOk } from '../utils/outcome.util';
import { roleKeyFromName } from '../utils/role-key.util';

const BUSINESS = '00000000-0000-4000-8000-000000000001';
const BRANCH = '00000000-0000-4000-8000-000000000002';
const TOKEN = 'a'.repeat(43);

describe('team utilities', () => {
  it('derives stable role keys', () => {
    expect(roleKeyFromName('  Release Manager! ')).toBe('release-manager');
    expect(roleKeyFromName('Café Lead')).toBe('cafe-lead');
    expect(roleKeyFromName('***')).toBe('role');
    expect(roleKeyFromName('x'.repeat(80))).toHaveLength(60);
  });

  it('maps SQL outcomes to HTTP errors and fails closed', () => {
    expect(() => assertOk('ok')).not.toThrow();
    expect(() => assertOk('not_found')).toThrow(NotFoundException);
    expect(() => assertOk('invalid')).toThrow(BadRequestException);
    expect(() => assertOk('conflict')).toThrow(ConflictException);
    expect(() => assertOk('forbidden')).toThrow(ForbiddenException);
    expect(() => assertOk('something-new')).toThrow(ForbiddenException);
    expect(() => assertOk(undefined)).toThrow(ForbiddenException);
  });
});

describe('RolesService', () => {
  const repository = {
    listPermissions: jest.fn(),
    listRoles: jest.fn(),
    saveRole: jest.fn(),
    deleteRole: jest.fn(),
  };
  const service = new RolesService(repository as never);
  beforeEach(() => jest.clearAllMocks());

  it('creates a role with a derived key and returns it', async () => {
    repository.saveRole.mockResolvedValue({ outcome: 'ok', roleId: 'r1' });
    repository.listRoles.mockResolvedValue([{ id: 'r1' }]);
    await expect(
      service.createRole('u', BUSINESS, {
        name: 'Shift Lead',
        permissions: ['business:read'],
      }),
    ).resolves.toEqual({ id: 'r1' });
    expect(repository.saveRole).toHaveBeenCalledWith('u', BUSINESS, {
      roleId: null,
      key: 'shift-lead',
      name: 'Shift Lead',
      description: null,
      branchId: null,
      permissions: ['business:read'],
    });
  });

  it('only sends the fields being changed', async () => {
    repository.saveRole.mockResolvedValue({ outcome: 'ok', roleId: 'r1' });
    repository.listRoles.mockResolvedValue([{ id: 'r1' }]);
    await service.updateRole('u', BUSINESS, 'r1', { description: '' });
    expect(repository.saveRole).toHaveBeenCalledWith('u', BUSINESS, {
      roleId: 'r1',
      key: null,
      name: null,
      description: '',
      branchId: null,
      permissions: null,
    });
  });

  it('turns duplicate names and roles in use into 409', async () => {
    repository.saveRole.mockResolvedValue({ outcome: 'conflict' });
    await expect(
      service.createRole('u', BUSINESS, { name: 'X', permissions: [] }),
    ).rejects.toBeInstanceOf(ConflictException);
    repository.deleteRole.mockResolvedValue('conflict');
    await expect(
      service.deleteRole('u', BUSINESS, 'r1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('answers 404 for an unknown role', async () => {
    repository.listRoles.mockResolvedValue([]);
    await expect(
      service.getRole('u', BUSINESS, 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MembersService', () => {
  const repository = {
    list: jest.fn().mockResolvedValue([{ userId: 'm' }]),
    overridesAndPermissions: jest
      .fn()
      .mockResolvedValue({ overrides: [], effectivePermissions: [] }),
    update: jest.fn().mockResolvedValue('ok'),
    end: jest.fn().mockResolvedValue('ok'),
    setOverride: jest.fn().mockResolvedValue('ok'),
    clearOverride: jest.fn().mockResolvedValue('ok'),
  };
  const service = new MembersService(repository as never);
  beforeEach(() => jest.clearAllMocks());

  it('requires a role or branch change', async () => {
    await expect(service.update('u', BUSINESS, 'm', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('distinguishes "make business-wide" (null) from "keep branch"', async () => {
    await service.update('u', BUSINESS, 'm', { branchId: null }, BRANCH);
    expect(repository.update).toHaveBeenCalledWith('u', BUSINESS, BRANCH, 'm', {
      changeRole: false,
      roleId: null,
      changeBranch: true,
      branchId: null,
    });
  });

  it('maps a refused change to 403 and a hidden member to 404', async () => {
    repository.update.mockResolvedValueOnce('forbidden');
    await expect(
      service.update('u', BUSINESS, 'm', { roleId: 'r' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    repository.end.mockResolvedValueOnce('not_found');
    await expect(service.end('u', BUSINESS, 'm')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects unknown permission keys before the database', async () => {
    await expect(
      service.setOverride('u', BUSINESS, 'm', 'nope', 'allow'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.setOverride).not.toHaveBeenCalled();
  });
});

describe('InvitationsService', () => {
  const repository = {
    create: jest.fn(),
    reissue: jest.fn(),
    revoke: jest.fn(),
    list: jest.fn(),
  };
  const email = { send: jest.fn().mockResolvedValue(undefined) };
  const service = new InvitationsService(
    repository as never,
    email as never,
    { frontendBaseUrl: 'https://app.fortis.test/' } as never,
  );
  beforeEach(() => jest.clearAllMocks());

  it('stores token hashes, emails only the invited and reports each address', async () => {
    repository.create.mockResolvedValue(['invited', 'already_member']);
    const result = await service.invite(
      { userId: 'u', name: 'Owner' },
      BUSINESS,
      { emails: ['a@x.test', 'b@x.test'], roleId: 'r' },
    );
    expect(result.results).toEqual([
      { email: 'a@x.test', status: 'invited' },
      { email: 'b@x.test', status: 'already_member' },
    ]);
    expect(email.send).toHaveBeenCalledTimes(1);
    const url = new URL(email.send.mock.calls[0][0].context.invitationUrl);
    const token = url.searchParams.get('token') ?? '';
    const stored = repository.create.mock.calls[0][3].invitations[0];
    expect(stored).toEqual({
      email: 'a@x.test',
      tokenHash: hashOpaqueToken(token),
    });
  });

  it('forces the branch of a branch route and rejects a different one', async () => {
    repository.create.mockResolvedValue(['invited']);
    await service.invite(
      { userId: 'u' },
      BUSINESS,
      { emails: ['a@x.test'], roleId: 'r' },
      BRANCH,
    );
    expect(repository.create.mock.calls[0][3].branchId).toBe(BRANCH);
    await expect(
      service.invite(
        { userId: 'u' },
        BUSINESS,
        { emails: ['a@x.test'], roleId: 'r', branchId: BUSINESS },
        BRANCH,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('MyInvitationsService', () => {
  const repository = {
    preview: jest.fn(),
    findCredential: jest.fn(),
    accept: jest.fn(),
  };
  const passwords = {
    verify: jest.fn(),
    verifyAgainstDummy: jest.fn().mockResolvedValue(false),
    hash: jest.fn().mockResolvedValue('argon-hash'),
  };
  const service = new MyInvitationsService(
    repository as never,
    passwords as never,
  );
  const preview = (accountExists: boolean) => ({
    email: 'p@x.test',
    accountExists,
  });
  beforeEach(() => jest.clearAllMocks());

  it('answers one 400 for an unusable token, after a dummy verify', async () => {
    repository.preview.mockResolvedValue(null);
    await expect(
      service.accept({ token: TOKEN, password: 'whatever' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(passwords.verifyAgainstDummy).toHaveBeenCalled();
  });

  it('needs the right password for an existing account', async () => {
    repository.preview.mockResolvedValue(preview(true));
    repository.findCredential.mockResolvedValue({
      id: 'u1',
      passwordHash: 'h',
      status: 'active',
    });
    passwords.verify.mockResolvedValueOnce({ valid: false });
    await expect(
      service.accept({ token: TOKEN, password: 'wrong' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.accept).not.toHaveBeenCalled();

    passwords.verify.mockResolvedValueOnce({ valid: true });
    repository.accept.mockResolvedValue({
      outcome: 'active_membership',
      userId: null,
      businessId: null,
    });
    await expect(
      service.accept({ token: TOKEN, password: 'right' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.accept).toHaveBeenCalledWith({
      tokenHash: hashOpaqueToken(TOKEN),
      userId: 'u1',
      name: null,
      passwordHash: null,
      confirmResignation: false,
    });
  });

  it('creates new accounts only with a name and a strong enough password', async () => {
    repository.preview.mockResolvedValue(preview(false));
    await expect(
      service.accept({ token: TOKEN, password: 'Long-enough-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.accept({ token: TOKEN, password: 'short', name: 'P' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    repository.accept.mockResolvedValue({
      outcome: 'accepted',
      userId: 'new',
      businessId: BUSINESS,
    });
    await expect(
      service.accept({ token: TOKEN, password: 'Long-enough-1', name: 'P' }),
    ).resolves.toEqual({
      businessId: BUSINESS,
      userId: 'new',
      accountCreated: true,
    });
    expect(repository.accept).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: 'argon-hash', name: 'P' }),
    );
  });
});
