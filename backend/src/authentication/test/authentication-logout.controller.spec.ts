import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { Test } from '@nestjs/testing';
import { AuthenticationLogoutController } from '../authentication-logout.controller';
import { PlatformAuthService } from '../authentication.service.platform';
import { UserAuthService } from '../authentication.service.user';
import { ClientType } from '../dto/clientLogin.dto';

describe('AuthenticationLogoutController', () => {
  const userAuthService = {
    invalidateRefreshTokenForSession: jest.fn(),
  };
  const platformAuthService = {
    invalidateRefreshTokenForSession: jest.fn(),
  };
  let controller: AuthenticationLogoutController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [AuthenticationLogoutController],
      providers: [
        { provide: UserAuthService, useValue: userAuthService },
        { provide: PlatformAuthService, useValue: platformAuthService },
      ],
    }).compile();
    controller = module.get(AuthenticationLogoutController);
  });

  it('revokes the authenticated web session and clears both cookies', async () => {
    const response = { clearCookie: jest.fn() };
    const request = {
      user: { isPlatform: false, userId: 'user-id' },
      cookies: { refresh_token: 'refresh-token' },
    };

    await expect(
      controller.logout(
        request as never,
        { clientType: ClientType.WEB },
        undefined as never,
        response as never,
      ),
    ).resolves.toEqual({ revoked: true });

    expect(
      userAuthService.invalidateRefreshTokenForSession,
    ).toHaveBeenCalledWith('refresh-token', 'user-id');
    expect(
      platformAuthService.invalidateRefreshTokenForSession,
    ).not.toHaveBeenCalled();
    expect(response.clearCookie).toHaveBeenNthCalledWith(1, 'access_token', {
      path: '/',
      sameSite: 'strict',
    });
    expect(response.clearCookie).toHaveBeenNthCalledWith(2, 'refresh_token', {
      path: '/',
      sameSite: 'strict',
    });
  });

  it('revokes a desktop session from the request body without setting cookies', async () => {
    const response = { clearCookie: jest.fn() };

    await expect(
      controller.logout(
        {
          user: { isPlatform: true, platformUserId: 'platform-user-id' },
          cookies: {},
        } as never,
        { clientType: ClientType.DESKTOP },
        { refreshToken: 'platform-refresh-token' },
        response as never,
      ),
    ).resolves.toEqual({ revoked: true });

    expect(
      platformAuthService.invalidateRefreshTokenForSession,
    ).toHaveBeenCalledWith('platform-refresh-token', 'platform-user-id');
    expect(
      userAuthService.invalidateRefreshTokenForSession,
    ).not.toHaveBeenCalled();
    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it('succeeds idempotently when no refresh token is available', async () => {
    const response = { clearCookie: jest.fn() };

    await expect(
      controller.logout(
        {
          user: { isPlatform: false, userId: 'user-id' },
          cookies: {},
        } as never,
        { clientType: ClientType.MOBILE },
        undefined as never,
        response as never,
      ),
    ).resolves.toEqual({ revoked: true });

    expect(
      userAuthService.invalidateRefreshTokenForSession,
    ).not.toHaveBeenCalled();
    expect(response.clearCookie).not.toHaveBeenCalled();
  });
});
