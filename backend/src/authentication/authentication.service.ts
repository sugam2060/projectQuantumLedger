import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { AuditLogsService, type AuditRequestContext } from '../audit-logs';
import type { AuthenticatedUser } from '../common/types';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  isOpaqueTokenShape,
} from '../common/utils/opaque-token.util';
import { authConfig } from '../config';
import { EffectivePermissionsService } from '../roles-permissions/effective-permissions.service';
import {
  AuthenticationRepository,
  type AuthTransaction,
} from './authentication.repository';
import type { ClientLoginDto, ClientType } from './dto/client-login.dto';
import type { OwnerRegistrationDto } from './dto/owner-registration.dto';
import type { ChangePasswordDto } from './dto/password.dto';
import { PasswordsRepository } from './passwords.repository';
import { PasswordService } from './password.service';
import { SessionsRepository } from './sessions.repository';
import { TokenService } from './token.service';
import type {
  ActiveMembership,
  ActiveTerminal,
  AuthMetadata,
  UserAccount,
  UserAuthResult,
} from './types';

const INVALID_CREDENTIALS = 'Invalid email or password';
const INVALID_REFRESH = 'Invalid refresh token';

/**
 * Business-user authentication: password sign-in bound to a terminal, refresh
 * with rotation and reuse detection (Postgres sessions), logout, logout-all,
 * /me, and owner registration.
 */
@Injectable()
export class AuthenticationService {
  private readonly logger = new Logger(AuthenticationService.name);

  constructor(
    private readonly repository: AuthenticationRepository,
    private readonly sessions: SessionsRepository,
    private readonly passwordsRepository: PasswordsRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly effectivePermissions: EffectivePermissionsService,
    private readonly auditLogs: AuditLogsService,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  async login(
    dto: ClientLoginDto,
    meta: AuthMetadata,
  ): Promise<UserAuthResult> {
    const email = dto.email.trim().toLowerCase();
    const credential = await this.repository.findCredentialByEmail(email);
    if (!credential) {
      await this.passwords.verifyAgainstDummy(dto.password);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const check = await this.passwords.verify(
      credential.passwordHash,
      dto.password,
    );
    if (!check.valid || credential.status !== 'active') {
      await this.auditFailure(
        credential.id,
        undefined,
        meta,
        'USER_LOGIN_FAILED',
      );
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (check.needsRehash) {
      await this.rehash(credential.id, dto.password);
    }

    const account: UserAccount = {
      id: credential.id,
      email: credential.email,
      name: credential.name,
      status: credential.status,
    };
    const binding = await this.bindMembership(account.id, meta.terminalId);
    if (!binding.ok) {
      await this.auditFailure(account.id, undefined, meta, 'USER_LOGIN_FAILED');
      throw new UnauthorizedException(binding.reason);
    }

    const result = await this.startSession(
      account,
      binding,
      meta,
      dto.remember === true,
    );
    await this.auditLogs.logUserEvent(
      { userId: account.id, businessId: binding.membership.businessId },
      {
        ...meta.audit,
        userId: account.id,
        businessId: binding.membership.businessId,
        terminalId: binding.terminal?.id,
        eventType: 'USER_LOGIN_SUCCESS',
        responseStatus: 200,
      },
    );
    return result;
  }

  /**
   * Swaps a refresh token for a new pair. A replayed (already rotated) token
   * revokes every session of the user; any failure is a plain 401.
   */
  async refresh(
    refreshToken: string | undefined,
    meta: AuthMetadata,
  ): Promise<UserAuthResult> {
    if (!isOpaqueTokenShape(refreshToken)) {
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    const nextToken = generateOpaqueToken();
    const nextHash = hashOpaqueToken(nextToken);
    const rotation = await this.sessions.rotate({
      oldHash: hashOpaqueToken(refreshToken),
      newHash: nextHash,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
      persistentTtlSeconds: this.config.refreshPersistentTtlSeconds,
      sessionTtlSeconds: this.config.refreshSessionTtlSeconds,
    });

    if (rotation.outcome === 'reuse' && rotation.userId) {
      await this.auditFailure(
        rotation.userId,
        undefined,
        meta,
        'USER_REFRESH_TOKEN_REUSE_DETECTED',
      );
    }
    if (rotation.outcome !== 'rotated' || !rotation.userId) {
      if (rotation.outcome === 'rotated') await this.sessions.revoke(nextHash);
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    const userId = rotation.userId;
    const fail = async (reason: string): Promise<never> => {
      await this.sessions.revoke(nextHash);
      await this.auditFailure(
        userId,
        undefined,
        meta,
        'USER_TOKEN_REFRESH_FAILED',
      );
      throw new UnauthorizedException(reason);
    };

    if (meta.terminalId && meta.terminalId !== rotation.terminalId) {
      return fail(INVALID_REFRESH);
    }
    const account = await this.repository.findAccount(userId);
    if (!account || account.status !== 'active') return fail(INVALID_REFRESH);

    const binding = await this.bindMembership(
      userId,
      rotation.terminalId ?? undefined,
    );
    if (!binding.ok) return fail(binding.reason);

    const result = await this.issue(
      account,
      binding,
      nextToken,
      rotation.persistent,
    );
    await this.auditLogs.logUserEvent(
      { userId, businessId: binding.membership.businessId },
      {
        ...meta.audit,
        userId,
        businessId: binding.membership.businessId,
        terminalId: binding.terminal?.id,
        eventType: 'USER_TOKEN_REFRESHED',
        responseStatus: 200,
      },
    );
    return result;
  }

  /**
   * Changes the signed-in user's password, signs out every device and starts a
   * new session for this one (login-shaped response).
   */
  async changePassword(
    user: AuthenticatedUser,
    dto: ChangePasswordDto,
    meta: AuthMetadata,
  ): Promise<UserAuthResult> {
    if (!user.userId) throw new UnauthorizedException();
    const userId = user.userId;

    const currentHash = await this.passwordsRepository.currentHash({ userId });
    if (!currentHash) throw new UnauthorizedException('Account is not active');
    if (!dto.currentPassword) {
      throw new BadRequestException('currentPassword is required');
    }
    const current = await this.passwords.verify(
      currentHash,
      dto.currentPassword,
    );
    if (!current.valid) {
      await this.auditFailure(
        userId,
        user.businessId,
        meta,
        'USER_PASSWORD_CHANGE_FAILED',
      );
      throw new ForbiddenException('Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'The new password must differ from the current one',
      );
    }

    await this.repository.updatePasswordHash(
      userId,
      await this.passwords.hash(dto.newPassword),
    );
    await this.sessions.revokeAll({ userId });

    const account = await this.repository.findAccount(userId);
    if (!account) throw new UnauthorizedException('Account is not active');
    const binding = await this.bindMembership(
      userId,
      user.terminalId ?? meta.terminalId,
    );
    if (!binding.ok) throw new UnauthorizedException(binding.reason);

    const result = await this.startSession(account, binding, meta, false);
    await this.auditLogs.logUserEvent(
      { userId, businessId: binding.membership.businessId },
      {
        ...meta.audit,
        userId,
        businessId: binding.membership.businessId,
        eventType: 'USER_PASSWORD_CHANGED',
        responseStatus: 200,
      },
    );
    return result;
  }

  /** Ends the session of this refresh token. Unknown tokens are ignored. */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (!isOpaqueTokenShape(refreshToken)) return;
    await this.sessions.revoke(hashOpaqueToken(refreshToken));
  }

  /** Ends every session of the signed-in user. */
  async logoutAll(user: AuthenticatedUser): Promise<{ revoked: number }> {
    if (!user.userId) throw new UnauthorizedException();
    const revoked = await this.sessions.revokeAll({ userId: user.userId });
    return { revoked };
  }

  async getCurrentUser(
    authenticatedUser: AuthenticatedUser,
    clientType: ClientType,
    requestedTerminalId?: string,
    initialLoad = true,
  ) {
    const { userId, businessId, branchId, roleId, roleVersion } =
      authenticatedUser;
    if (!userId || authenticatedUser.isPlatform) {
      throw new UnauthorizedException('A user access token is required');
    }

    // The access token is stateless: re-check that the account and the
    // membership it was issued for are still active.
    const account = await this.repository.findAccount(userId);
    if (!account || account.status !== 'active') {
      throw new UnauthorizedException('Account is not active');
    }
    const memberships = await this.repository.listActiveMemberships(userId);
    if (
      businessId &&
      !memberships.some((membership) => membership.businessId === businessId)
    ) {
      throw new UnauthorizedException('Business membership is not active');
    }

    let effectivePermissions: string[] | undefined;
    let currentRoleVersion = roleVersion;
    if (initialLoad) {
      effectivePermissions = [];
      if (businessId && roleId) {
        const snapshot = await this.effectivePermissions.resolve({
          userId,
          businessId,
          roleId,
        });
        if (snapshot) {
          effectivePermissions = snapshot.permissions;
          currentRoleVersion = snapshot.roleVersion ?? roleVersion;
        }
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const tokenExpiresAt = authenticatedUser.tokenExpiresAt;
    const issuedAt = authenticatedUser.tokenIssuedAt;

    return {
      user: { id: userId, email: account.email, name: account.name },
      activeContext: businessId
        ? { businessId, branchId: branchId ?? null }
        : null,
      is_owner: authenticatedUser.isOwner === true,
      role_template: roleId ?? null,
      role_template_version:
        currentRoleVersion === undefined || currentRoleVersion === null
          ? null
          : String(currentRoleVersion),
      ...(effectivePermissions && { effectivePermissions }),
      session: {
        clientType,
        terminalId: authenticatedUser.terminalId ?? requestedTerminalId ?? null,
        issuedAt: issuedAt ? new Date(issuedAt * 1000).toISOString() : null,
        expiresAt: tokenExpiresAt
          ? new Date(tokenExpiresAt * 1000).toISOString()
          : null,
        expiresInSeconds:
          tokenExpiresAt === undefined
            ? null
            : Math.max(0, tokenExpiresAt - now),
      },
    };
  }

  /**
   * First owner of a provisioned business: redeems the emailed code, creates (or
   * re-authenticates) the account, adds the owner membership, activates the
   * business and its first terminal, all in one transaction. Issues no tokens.
   */
  async registerOwner(
    dto: OwnerRegistrationDto,
    auditContext: AuditRequestContext = {},
  ) {
    const email = dto.email.trim().toLowerCase();
    const tokenHash = createHash('sha256')
      .update(dto.redeemCode.trim())
      .digest('hex');
    const terminalCode = dto.terminalCode.trim().toUpperCase();

    try {
      return await this.repository.inRegistrationTransaction(async (tx) => {
        await this.repository.setRedemptionContext(tx, { tokenHash, email });
        const redemption = await this.repository.lockOpenRedemption(
          tx,
          tokenHash,
        );
        if (!redemption || redemption.email !== email) {
          throw new UnauthorizedException('Invalid or expired redemption code');
        }
        if (redemption.businessId !== dto.businessId) {
          throw new UnauthorizedException(
            'Invalid terminal activation details',
          );
        }

        await this.repository.setBusinessContext(tx, redemption.businessId);
        const businessState = await this.repository.findBusinessState(
          tx,
          redemption.businessId,
        );
        if (!businessState)
          throw new NotFoundException('Business was not found');
        if (businessState.isActive) {
          throw new ConflictException('Business has already been activated');
        }

        const userId = await this.resolveOwnerAccount(tx, email, dto);

        await this.repository.setUserContext(tx, userId);
        await this.repository.insertOwnerMembership(tx, {
          businessId: redemption.businessId,
          userId,
        });
        await this.repository.activateBusiness(tx, redemption.businessId);
        await this.repository.setTerminalActivationContext(tx, {
          businessId: dto.businessId,
          branchId: dto.branchId,
          terminalCode,
          tokenHash,
        });
        const initialTerminal = await this.repository.findInactiveTerminal(tx, {
          businessId: redemption.businessId,
          branchId: dto.branchId,
          terminalCode,
        });
        if (!initialTerminal) {
          throw new ConflictException(
            'Terminal activation details are invalid or the terminal is already active',
          );
        }
        await this.repository.activateTerminal(tx, initialTerminal.terminalId);
        await this.repository.consumeRedemption(tx, {
          redemptionId: redemption.id,
          userId,
        });
        await this.auditLogs.insertUserEvent(tx, {
          ...auditContext,
          userId,
          businessId: redemption.businessId,
          eventType: 'OWNER_REGISTERED',
          responseStatus: 201,
          metadata: { isOwner: true },
        });

        return {
          message: 'Owner account registered and business activated.',
          userId,
          businessId: redemption.businessId,
          isOwner: true,
          roleId: null,
          branchId: null,
          initialTerminalId: initialTerminal.terminalId,
          initialBranchId: initialTerminal.branchId,
        };
      });
    } catch (error) {
      const constraint = postgresConstraintName(error);
      if (constraint === 'business_memberships_user_business_uq') {
        throw new ConflictException(
          'User already has a membership in this business',
        );
      }
      if (constraint === 'users_email_uq') {
        throw new ConflictException(
          'An account with this email was created concurrently',
        );
      }
      throw error;
    }
  }

  private async resolveOwnerAccount(
    tx: AuthTransaction,
    email: string,
    dto: OwnerRegistrationDto,
  ): Promise<string> {
    const existing = await this.repository.findUserByEmailForRegistration(
      tx,
      email,
    );
    if (existing) {
      const check = await this.passwords.verify(
        existing.passwordHash,
        dto.password,
      );
      if (existing.status !== 'active' || !check.valid) {
        throw new UnauthorizedException(INVALID_CREDENTIALS);
      }
      return existing.id;
    }
    const created = await this.repository.insertUser(tx, {
      email,
      passwordHash: await this.passwords.hash(dto.password),
      name: dto.name.trim(),
    });
    if (!created) throw new Error('Owner user could not be created');
    return created;
  }

  /**
   * Picks the membership a session works under. With a terminal, the membership
   * must belong to the terminal's business and cover its branch.
   */
  private async bindMembership(
    userId: string,
    terminalId: string | undefined,
  ): Promise<
    | {
        ok: true;
        membership: ActiveMembership;
        memberships: ActiveMembership[];
        terminal: ActiveTerminal | null;
      }
    | { ok: false; reason: string }
  > {
    const memberships = await this.repository.listActiveMemberships(userId);
    const terminal = terminalId
      ? await this.repository.findActiveTerminal(terminalId)
      : null;
    if (terminalId && !terminal) {
      return { ok: false, reason: 'Terminal is not active' };
    }
    const membership = memberships.find((candidate) =>
      terminal
        ? candidate.businessId === terminal.businessId &&
          (candidate.isOwner ||
            candidate.branchId === null ||
            candidate.branchId === terminal.branchId)
        : true,
    );
    if (!membership) {
      return { ok: false, reason: 'No active business membership' };
    }
    return { ok: true, membership, memberships, terminal };
  }

  private async startSession(
    account: UserAccount,
    binding: {
      membership: ActiveMembership;
      memberships: ActiveMembership[];
      terminal: ActiveTerminal | null;
    },
    meta: AuthMetadata,
    persistent: boolean,
  ): Promise<UserAuthResult> {
    const refreshToken = generateOpaqueToken();
    await this.sessions.create(
      { userId: account.id },
      {
        tokenHash: hashOpaqueToken(refreshToken),
        clientType: meta.clientType,
        terminalId: binding.terminal?.id ?? null,
        persistent,
        userAgent: meta.userAgent ?? null,
        ip: meta.ip ?? null,
        expiresAt: new Date(Date.now() + this.refreshTtlMs(persistent)),
      },
    );
    return this.issue(account, binding, refreshToken, persistent);
  }

  private async issue(
    account: UserAccount,
    binding: {
      membership: ActiveMembership;
      memberships: ActiveMembership[];
      terminal: ActiveTerminal | null;
    },
    refreshToken: string,
    persistent: boolean,
  ): Promise<UserAuthResult> {
    const { membership, terminal } = binding;
    const snapshot = membership.roleId
      ? await this.effectivePermissions.resolve({
          userId: account.id,
          businessId: membership.businessId,
          roleId: membership.roleId,
        })
      : null;
    const branchId = terminal?.branchId ?? membership.branchId ?? undefined;
    const roleVersion = snapshot?.roleVersion ?? membership.roleVersion;

    const access = await this.tokens.signUserToken({
      sub: account.id,
      email: account.email,
      name: account.name,
      businessId: membership.businessId,
      branchId,
      terminalId: terminal?.id,
      isOwner: membership.isOwner,
      ...(membership.roleId
        ? {
            role_id: membership.roleId,
            role_version: roleVersion ?? undefined,
          }
        : {}),
    });

    return {
      accessToken: access.token,
      refreshToken,
      refreshMaxAgeMs: persistent ? this.refreshTtlMs(true) : undefined,
      tokenType: 'Bearer',
      expiresIn: access.expiresIn,
      user: { id: account.id, email: account.email, name: account.name },
      memberships: binding.memberships.map((item) => ({
        businessId: item.businessId,
        branchId: item.branchId,
        isOwner: item.isOwner,
        roleId: item.roleId,
        role: item.roleName,
        roleVersion: item.roleVersion,
      })),
      effectivePermissions: snapshot?.permissions ?? [],
    };
  }

  private refreshTtlMs(persistent: boolean): number {
    return (
      (persistent
        ? this.config.refreshPersistentTtlSeconds
        : this.config.refreshSessionTtlSeconds) * 1000
    );
  }

  private async rehash(userId: string, password: string): Promise<void> {
    try {
      await this.repository.updatePasswordHash(
        userId,
        await this.passwords.hash(password),
      );
    } catch (error) {
      this.logger.warn(
        `Could not upgrade the password hash of user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private auditFailure(
    userId: string,
    businessId: string | undefined,
    meta: AuthMetadata,
    eventType: string,
  ): Promise<void> {
    return this.auditLogs.logUserEvent(
      { userId, businessId },
      {
        ...meta.audit,
        userId,
        businessId,
        terminalId: meta.terminalId,
        eventType,
        responseStatus: 401,
      },
    );
  }
}

function postgresConstraintName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('cause' in error)) {
    return undefined;
  }
  const cause = error.cause;
  if (typeof cause !== 'object' || cause === null || !('constraint' in cause)) {
    return undefined;
  }
  return typeof cause.constraint === 'string' ? cause.constraint : undefined;
}
