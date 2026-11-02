import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ClientTypePipe } from '../pipes/client-type.pipe';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = {
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
  };
  const responseMock = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    setHeader: jest.fn(),
  };
  const response = responseMock as unknown as Response;
  const configService = {
    get: jest.fn().mockReturnValue('test'),
  };
  const result = {
    accessToken: 'signed-access-token',
    refreshToken: 'session-id.random-refresh-secret',
    tokenType: 'Bearer',
    expiresIn: 900,
    user: {
      id: '98b336f3-4481-4c90-a26a-388ae29ff607',
      email: 'person@example.com',
    },
    memberships: [
      {
        businessId: '63969df4-d55f-4f82-b6fd-169c10c4a115',
        branchIds: ['2e8eea09-73ae-427e-bb4d-6a48dd6a08b9'],
      },
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: configService },
        ClientTypePipe,
        { provide: JwtAuthGuard, useValue: {} },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService.login.mockResolvedValue(result);
    authService.refresh.mockResolvedValue(result);
  });

  it('returns tokens and memberships to a desktop client without setting cookies', async () => {
    const credentials = {
      email: 'person@example.com',
      password: 'correct-password',
      deviceLabel: 'POS-01',
    };

    await expect(
      controller.login(credentials, 'desktop', response),
    ).resolves.toEqual(result);

    expect(authService.login).toHaveBeenCalledWith(credentials, {
      clientType: 'desktop',
    });
    expect(responseMock.cookie).not.toHaveBeenCalled();
  });

  it('sets http-only cookies for web clients and omits tokens from the body', async () => {
    await expect(
      controller.login(
        { email: 'person@example.com', password: 'correct-password' },
        'web',
        response,
      ),
    ).resolves.toEqual({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: result.user,
      memberships: result.memberships,
    });

    expect(responseMock.cookie).toHaveBeenCalledTimes(2);
    expect(responseMock.cookie).toHaveBeenNthCalledWith(
      1,
      'access_token',
      result.accessToken,
      expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
    );
    expect(responseMock.cookie).toHaveBeenNthCalledWith(
      2,
      'refresh_token',
      result.refreshToken,
      expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
    );
  });

  it('returns a rotated token response to non-web refresh clients', async () => {
    await expect(
      controller.refresh(
        { refreshToken: result.refreshToken },
        'mobile',
        { headers: {} } as never,
        response,
      ),
    ).resolves.toEqual(result);

    expect(authService.refresh).toHaveBeenCalledWith(result.refreshToken, {
      clientType: 'mobile',
    });
  });
});
