import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { Test, TestingModule } from '@nestjs/testing';
import { AuthenticationController } from '../authentication.controller';
import { UserAuthService } from '../authentication.service.user';
import { ClientLoginDTO, ClientType } from '../dto/clientLogin.dto';
import { REQUIRED_ROLES } from '../decorators/required_permission.decorator';
import {
  BadRequestException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthenticationMeHeadersDto } from '../dto/authentication-me-headers.dto';
import { AuthenticationLoginHeadersDto } from '../dto/authentication-login-headers.dto';

describe('AuthenticationController', () => {
  let controller: AuthenticationController;
  let authServiceMock: any;

  beforeEach(async () => {
    // Mock the UserAuthService
    authServiceMock = {
      userLogin: jest.fn(),
      getCurrentUser: jest.fn(),
      refreshAccessToken: jest.fn(),
      invalidateRefreshToken: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthenticationController],
      providers: [
        {
          provide: UserAuthService,
          useValue: authServiceMock,
        },
      ],
    }).compile();

    controller = module.get<AuthenticationController>(AuthenticationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /authentication/me', () => {
    it('requires authentication, applies rate limiting, and has no permission key', async () => {
      const handler = AuthenticationController.prototype.getCurrentUser;
      expect(Reflect.getMetadata('isPublic', handler)).not.toBe(true);
      expect(Reflect.getMetadata('rateLimit', handler)).toEqual(
        expect.objectContaining({ requests: 60, windowMs: 60_000 }),
      );
      expect(Reflect.getMetadata(REQUIRED_ROLES, handler)).toBeUndefined();
    });

    it('returns the authenticated user context', async () => {
      const user = {
        userId: '00000000-0000-4000-8000-000000000001',
        permissions: [],
      };
      const result = { id: user.userId, effectivePermissions: [] };
      authServiceMock.getCurrentUser.mockResolvedValue(result);

      await expect(
        controller.getCurrentUser({ user } as never, {
          clientType: ClientType.MOBILE,
          terminalId: '00000000-0000-4000-8000-000000000002',
          initialLoad: true,
        }),
      ).resolves.toBe(result);
      expect(authServiceMock.getCurrentUser).toHaveBeenCalledWith(
        user,
        ClientType.MOBILE,
        '00000000-0000-4000-8000-000000000002',
        true,
      );
    });

    it('validates and maps the required client and terminal headers', async () => {
      const pipe = new ValidationPipe({
        whitelist: true,
        transform: true,
        validateCustomDecorators: true,
      });
      const headers = await pipe.transform(
        {
          clientType: ClientType.WEB,
          terminalId: '00000000-0000-4000-8000-000000000002',
          initialLoad: true,
        },
        { type: 'custom', metatype: AuthenticationMeHeadersDto },
      );

      expect(headers).toEqual({
        clientType: ClientType.WEB,
        terminalId: '00000000-0000-4000-8000-000000000002',
        initialLoad: true,
      });

      const falseHeader = await pipe.transform(
        {
          clientType: ClientType.WEB,
          terminalId: '00000000-0000-4000-8000-000000000002',
          initialLoad: 'false',
        },
        { type: 'custom', metatype: AuthenticationMeHeadersDto },
      );
      expect(falseHeader.initialLoad).toBe(false);

      const defaultHeaders = await pipe.transform(
        {
          clientType: ClientType.WEB,
          terminalId: '00000000-0000-4000-8000-000000000002',
        },
        { type: 'custom', metatype: AuthenticationMeHeadersDto },
      );
      expect(defaultHeaders.initialLoad).toBe(true);

      await expect(
        pipe.transform(
          {
            clientType: 'invalid',
            terminalId: 'bad-id',
          },
          { type: 'custom', metatype: AuthenticationMeHeadersDto },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('login', () => {
    const mockDto: ClientLoginDTO = {
      email: 'test@example.com',
      password: 'password123',
      remember: true,
    };

    const mockRequest = {
      secure: false,
      headers: {
        'x-forwarded-proto': 'http',
        'x-client-type': 'web',
        'x-terminal-id': '00000000-0000-4000-8000-000000000002',
      },
    } as any;

    const mockResponse = {
      cookie: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as any as Response;

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('keeps the login DTO class available for global validation', () => {
      const parameterTypes = Reflect.getMetadata(
        'design:paramtypes',
        AuthenticationController.prototype,
        'login',
      ) as unknown[];

      expect(parameterTypes[0]).toBe(ClientLoginDTO);
    });

    it('should successfully login and return result for web client with cookies', async () => {
      const mockResult = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        effectivePermissions: ['inventory.create'],
        user: { id: 'user123', email: 'test@example.com' },
        memberships: [],
      };

      authServiceMock.userLogin.mockResolvedValue(mockResult);

      const result = await controller.login(
        mockDto,
        {
          clientType: ClientType.WEB,
          terminalId: '00000000-0000-4000-8000-000000000002',
        },
        mockRequest,
        mockResponse,
      );

      expect(authServiceMock.userLogin).toHaveBeenCalledWith(
        mockDto,
        '00000000-0000-4000-8000-000000000002',
      );
      expect(mockResponse.cookie).toHaveBeenCalledTimes(2);
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'access_token',
        'mock-access-token',
        expect.objectContaining({
          httpOnly: true,
          secure: false,
          sameSite: 'strict',
          path: '/',
        }),
      );
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'mock-refresh-token',
        expect.objectContaining({
          httpOnly: true,
          secure: false,
          sameSite: 'strict',
          path: '/',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        }),
      );
      expect(result).toEqual({
        effectivePermissions: ['inventory.create'],
        user: { id: 'user123', email: 'test@example.com' },
        memberships: [],
      });
    });

    it('should successfully login and return tokens for mobile client', async () => {
      const mobileHeaders: AuthenticationLoginHeadersDto = {
        clientType: ClientType.MOBILE,
        terminalId: '00000000-0000-4000-8000-000000000002',
      };
      const mockResult = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        effectivePermissions: ['inventory.create'],
        user: { id: 'user123', email: 'test@example.com' },
        memberships: [],
      };

      authServiceMock.userLogin.mockResolvedValue(mockResult);

      const result = await controller.login(
        mockDto,
        mobileHeaders,
        mockRequest,
        mockResponse,
      );

      expect(authServiceMock.userLogin).toHaveBeenCalledWith(
        mockDto,
        '00000000-0000-4000-8000-000000000002',
      );
      expect(mockResponse.cookie).not.toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });

    it('returns both tokens in the response and sets no cookies for desktop clients', async () => {
      const desktopHeaders: AuthenticationLoginHeadersDto = {
        clientType: ClientType.DESKTOP,
        terminalId: '00000000-0000-4000-8000-000000000002',
      };
      const mockResult = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        effectivePermissions: ['inventory.create'],
        user: { id: 'user123', email: 'test@example.com' },
        memberships: [],
      };
      authServiceMock.userLogin.mockResolvedValue(mockResult);

      await expect(
        controller.login(mockDto, desktopHeaders, mockRequest, mockResponse),
      ).resolves.toMatchObject({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      });
      expect(mockResponse.cookie).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when email is missing', async () => {
      const invalidDto: any = { ...mockDto, email: undefined };

      authServiceMock.userLogin.mockRejectedValue(
        new BadRequestException('Valid email is required'),
      );

      await expect(
        controller.login(
          invalidDto,
          {
            terminalId: '00000000-0000-4000-8000-000000000002',
          },
          mockRequest,
          mockResponse,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.login(
          invalidDto,
          {
            terminalId: '00000000-0000-4000-8000-000000000002',
          },
          mockRequest,
          mockResponse,
        ),
      ).rejects.toThrow('Valid email is required');
    });

    it('should throw BadRequestException when password is missing', async () => {
      const invalidDto: any = { ...mockDto, password: undefined };

      authServiceMock.userLogin.mockRejectedValue(
        new BadRequestException('Valid password is required'),
      );

      await expect(
        controller.login(
          invalidDto,
          {
            terminalId: '00000000-0000-4000-8000-000000000002',
          },
          mockRequest,
          mockResponse,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.login(
          invalidDto,
          {
            terminalId: '00000000-0000-4000-8000-000000000002',
          },
          mockRequest,
          mockResponse,
        ),
      ).rejects.toThrow('Valid password is required');
    });

    it('should handle unauthorized access', async () => {
      authServiceMock.userLogin.mockRejectedValue(
        new UnauthorizedException('Invalid credentials'),
      );

      await expect(
        controller.login(
          mockDto,
          {
            terminalId: '00000000-0000-4000-8000-000000000002',
          },
          mockRequest,
          mockResponse,
        ),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        controller.login(
          mockDto,
          {
            terminalId: '00000000-0000-4000-8000-000000000002',
          },
          mockRequest,
          mockResponse,
        ),
      ).rejects.toThrow('Invalid credentials');
    });
  });

  describe('refreshToken', () => {
    const mockRequest = {
      secure: false,
      headers: { 'x-forwarded-proto': 'http', 'x-client-type': 'web' },
      cookies: { refresh_token: 'cookie-refresh-token' },
    } as any;

    const mockResponse = {
      cookie: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as any as Response;

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should successfully refresh token for web client and set cookies', async () => {
      const mockResult = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        effectivePermissions: ['inventory.create'],
        user: { id: 'user123', email: 'test@example.com' },
        memberships: [],
      };

      authServiceMock.refreshAccessToken.mockResolvedValue(mockResult);

      const result = await controller.refreshToken(
        'body-refresh-token',
        {
          clientType: ClientType.WEB,
          terminalId: '00000000-0000-4000-8000-000000000002',
        },
        mockRequest,
        mockResponse,
      );

      expect(authServiceMock.refreshAccessToken).toHaveBeenCalledWith(
        'body-refresh-token',
        '00000000-0000-4000-8000-000000000002',
      );
      expect(mockResponse.cookie).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        effectivePermissions: ['inventory.create'],
        user: { id: 'user123', email: 'test@example.com' },
        memberships: [],
      });
    });

    it('should successfully refresh token from cookie for web client', async () => {
      const mockRequestWithoutBodyToken: any = {
        ...mockRequest,
        headers: { 'x-client-type': 'web' },
      };

      const mockResult = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        effectivePermissions: ['inventory.create'],
        user: { id: 'user123', email: 'test@example.com' },
        memberships: [],
      };

      authServiceMock.refreshAccessToken.mockResolvedValue(mockResult);

      const result = await controller.refreshToken(
        undefined,
        {
          clientType: ClientType.WEB,
          terminalId: '00000000-0000-4000-8000-000000000002',
        },
        mockRequestWithoutBodyToken,
        mockResponse,
      );

      expect(authServiceMock.refreshAccessToken).toHaveBeenCalledWith(
        'cookie-refresh-token',
        '00000000-0000-4000-8000-000000000002',
      );
      expect(result).toEqual({
        effectivePermissions: ['inventory.create'],
        user: { id: 'user123', email: 'test@example.com' },
        memberships: [],
      });
    });

    it('returns both refreshed tokens in JSON without setting cookies for desktop clients', async () => {
      const mockRequestDesktop = {
        secure: false,
        headers: { 'x-forwarded-proto': 'http', 'x-client-type': 'desktop' },
        cookies: {},
      } as any;
      const mockResult = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        effectivePermissions: ['inventory.create'],
        user: { id: 'user123', email: 'test@example.com' },
      };
      authServiceMock.refreshAccessToken.mockResolvedValue(mockResult);

      await expect(
        controller.refreshToken(
          'body-refresh-token',
          {
            clientType: ClientType.DESKTOP,
            terminalId: '00000000-0000-4000-8000-000000000002',
          },
          mockRequestDesktop,
          mockResponse,
        ),
      ).resolves.toEqual(mockResult);
      expect(mockResponse.cookie).not.toHaveBeenCalled();
    });

    it('returns both refreshed tokens in JSON without setting cookies for mobile clients', async () => {
      const mockRequestMobile = {
        secure: false,
        headers: { 'x-forwarded-proto': 'http', 'x-client-type': 'mobile' },
        cookies: {},
      } as any;
      const mockResult = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        effectivePermissions: ['inventory.create'],
        user: { id: 'user123', email: 'test@example.com' },
      };
      authServiceMock.refreshAccessToken.mockResolvedValue(mockResult);

      await expect(
        controller.refreshToken(
          'body-refresh-token',
          {
            clientType: ClientType.MOBILE,
            terminalId: '00000000-0000-4000-8000-000000000002',
          },
          mockRequestMobile,
          mockResponse,
        ),
      ).resolves.toEqual(mockResult);
      expect(mockResponse.cookie).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when no refresh token provided', async () => {
      const mockRequestWithoutToken: any = {
        headers: { 'x-client-type': 'web' },
        cookies: {},
      };

      await expect(
        controller.refreshToken(
          undefined,
          {
            clientType: ClientType.WEB,
            terminalId: '00000000-0000-4000-8000-000000000002',
          },
          mockRequestWithoutToken,
          mockResponse,
        ),
      ).rejects.toThrow('Refresh token is required');
    });

    it('should handle unauthorized refresh token', async () => {
      authServiceMock.refreshAccessToken.mockRejectedValue(
        new UnauthorizedException('Invalid refresh token'),
      );
      authServiceMock.invalidateRefreshToken.mockResolvedValue(undefined);

      await expect(
        controller.refreshToken(
          'invalid-token',
          {
            clientType: ClientType.WEB,
            terminalId: '00000000-0000-4000-8000-000000000002',
          },
          mockRequest,
          mockResponse,
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(authServiceMock.invalidateRefreshToken).toHaveBeenCalledWith(
        'invalid-token',
      );
    });
  });
});
