import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { Test } from '@nestjs/testing';
import { ClientType } from '../dto/clientLogin.dto';
import { AuthenticationPlatformController } from '../authentication.platform.controller';
import { PlatformAuthService } from '../authentication.service.platform';
import { IS_PUBLIC } from '../decorators/public.decorator';
import { RATE_LIMIT_KEY } from '../decorators/rate-limit.decorator';

describe('AuthenticationPlatformController', () => {
  const platformAuthService = {
    login: jest.fn(),
    refresh: jest.fn(),
  };
  let controller: AuthenticationPlatformController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [AuthenticationPlatformController],
      providers: [
        { provide: PlatformAuthService, useValue: platformAuthService },
      ],
    }).compile();
    controller = module.get(AuthenticationPlatformController);
  });

  const authResult = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    tokenType: 'Bearer' as const,
    expiresIn: 900,
    user: { id: 'platform-user-id', displayName: 'Platform User' },
    isPlatform: true as const,
    isBootstrap: false,
  };

  it('keeps platform login public and rate limited', () => {
    const loginHandler = AuthenticationPlatformController.prototype.login;

    expect(Reflect.getMetadata(IS_PUBLIC, loginHandler)).toBe(true);
    expect(Reflect.getMetadata(RATE_LIMIT_KEY, loginHandler)).toEqual(
      expect.objectContaining({ requests: 20, windowMs: 60_000 }),
    );
  });

  it('sets HTTP-only cookies for web login and omits tokens from the body', async () => {
    const dto = {
      email: 'platform@example.com',
      password: 'password',
    };
    const response = { cookie: jest.fn() };
    platformAuthService.login.mockResolvedValue(authResult);

    await expect(
      controller.login(
        dto,
        {
          secure: true,
          headers: { 'x-client-type': ClientType.WEB },
        } as never,
        response as never,
      ),
    ).resolves.toEqual({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: authResult.user,
      isPlatform: true,
      isBootstrap: false,
    });
    expect(response.cookie).toHaveBeenCalledTimes(2);
    expect(response.cookie).toHaveBeenNthCalledWith(
      1,
      'access_token',
      authResult.accessToken,
      expect.objectContaining({ httpOnly: true, secure: true }),
    );
    expect(response.cookie).toHaveBeenNthCalledWith(
      2,
      'refresh_token',
      authResult.refreshToken,
      expect.objectContaining({
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      }),
    );
    expect(platformAuthService.login).toHaveBeenCalledWith(dto);
  });

  it('returns tokens in the body for mobile login', async () => {
    const dto = {
      email: 'platform@example.com',
      password: 'password',
    };
    platformAuthService.login.mockResolvedValue(authResult);

    await expect(
      controller.login(
        dto,
        {
          secure: false,
          headers: { 'x-client-type': ClientType.MOBILE },
        } as never,
        {
          cookie: jest.fn(),
        } as never,
      ),
    ).resolves.toEqual(authResult);
  });

  it('sets replacement cookies when a web client refreshes with its cookie', async () => {
    const response = { cookie: jest.fn() };
    platformAuthService.refresh.mockResolvedValue(authResult);

    await expect(
      controller.refresh(
        {
          'x-client-type': 'web',
        },
        {
          cookies: { refresh_token: 'cookie-refresh-token' },
          secure: true,
          headers: {},
        } as never,
        response as never,
      ),
    ).resolves.toEqual({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: authResult.user,
      isPlatform: true,
      isBootstrap: false,
    });
    expect(platformAuthService.refresh).toHaveBeenCalledWith(
      'cookie-refresh-token',
    );
    expect(response.cookie).toHaveBeenCalledTimes(2);
  });

  it('uses the refresh-token header for a mobile client', async () => {
    platformAuthService.refresh.mockResolvedValue(authResult);

    await expect(
      controller.refresh(
        { 'refresh-token': 'header-refresh-token', 'x-client-type': 'mobile' },
        { headers: {} } as never,
        { cookie: jest.fn() } as never,
      ),
    ).resolves.toEqual(authResult);
    expect(platformAuthService.refresh).toHaveBeenCalledWith(
      'header-refresh-token',
    );
  });
});
