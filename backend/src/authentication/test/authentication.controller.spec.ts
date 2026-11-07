import { Test, TestingModule } from '@nestjs/testing';
import { AuthenticationController } from '../authentication.controller';
import { UserAuthService } from '../authentication.service.user';
import { ClientLoginDTO, ClientType } from '../dto/clientLogin.dto';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Response } from 'express';

describe('AuthenticationController', () => {
  let controller: AuthenticationController;
  let authServiceMock: any;

  beforeEach(async () => {
    // Mock the UserAuthService
    authServiceMock = {
      userLogin: jest.fn(),
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

  describe('login', () => {
    const mockDto: ClientLoginDTO = {
      email: 'test@example.com',
      password: 'password123',
      remember: true,
      client_type: ClientType.WEB,
    };

    const mockRequest = {
      secure: false,
      headers: { 'x-forwarded-proto': 'http' },
    } as any;

    const mockResponse = {
      cookie: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as any as Response;

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should successfully login and return result for web client with cookies', async () => {
      const mockResult = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        user: { id: 'user123', email: 'test@example.com' },
        memberships: [],
      };

      authServiceMock.userLogin.mockResolvedValue(mockResult);

      const result = await controller.login(mockDto, mockRequest, mockResponse);

      expect(authServiceMock.userLogin).toHaveBeenCalledWith(mockDto);
      expect(mockResponse.cookie).toHaveBeenCalledTimes(2);
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'access_token',
        'mock-access-token',
        expect.objectContaining({
          httpOnly: true,
          secure: false,
          sameSite: 'strict',
          path: '/',
        })
      );
      expect(result).toEqual({
        user: { id: 'user123', email: 'test@example.com' },
        memberships: [],
      });
    });

    it('should successfully login and return tokens for mobile client', async () => {
      const mobileDto = { ...mockDto, client_type: ClientType.MOBILE };
      const mockResult = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        user: { id: 'user123', email: 'test@example.com' },
        memberships: [],
      };

      authServiceMock.userLogin.mockResolvedValue(mockResult);

      const result = await controller.login(mobileDto, mockRequest, mockResponse);

      expect(authServiceMock.userLogin).toHaveBeenCalledWith(mobileDto);
      expect(mockResponse.cookie).not.toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });

    it('should throw BadRequestException when email is missing', async () => {
      const invalidDto = { ...mockDto, email: undefined };

      authServiceMock.userLogin.mockRejectedValue(new BadRequestException('Valid email is required'));

      await expect(controller.login(invalidDto, mockRequest, mockResponse)).rejects.toThrow(BadRequestException);
      await expect(controller.login(invalidDto, mockRequest, mockResponse)).rejects.toThrow('Valid email is required');
    });

    it('should throw BadRequestException when password is missing', async () => {
      const invalidDto = { ...mockDto, password: undefined };

      authServiceMock.userLogin.mockRejectedValue(new BadRequestException('Valid password is required'));

      await expect(controller.login(invalidDto, mockRequest, mockResponse)).rejects.toThrow(BadRequestException);
      await expect(controller.login(invalidDto, mockRequest, mockResponse)).rejects.toThrow('Valid password is required');
    });

    it('should handle unauthorized access', async () => {
      authServiceMock.userLogin.mockRejectedValue(new UnauthorizedException('Invalid credentials'));

      await expect(controller.login(mockDto, mockRequest, mockResponse)).rejects.toThrow(UnauthorizedException);
      await expect(controller.login(mockDto, mockRequest, mockResponse)).rejects.toThrow('Invalid credentials');
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
        user: { id: 'user123', email: 'test@example.com' },
        memberships: [],
      };

      authServiceMock.refreshAccessToken.mockResolvedValue(mockResult);

      const result = await controller.refreshToken('body-refresh-token', mockRequest, mockResponse);

      expect(authServiceMock.refreshAccessToken).toHaveBeenCalledWith('body-refresh-token');
      expect(mockResponse.cookie).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        user: { id: 'user123', email: 'test@example.com' },
        memberships: [],
      });
    });

    it('should successfully refresh token from cookie for web client', async () => {
      const mockRequestWithoutBodyToken = {
        ...mockRequest,
        headers: { 'x-client-type': 'web' },
      };

      const mockResult = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        user: { id: 'user123', email: 'test@example.com' },
        memberships: [],
      };

      authServiceMock.refreshAccessToken.mockResolvedValue(mockResult);

      const result = await controller.refreshToken(undefined, mockRequestWithoutBodyToken, mockResponse);

      expect(authServiceMock.refreshAccessToken).toHaveBeenCalledWith('cookie-refresh-token');
      expect(result).toEqual({
        user: { id: 'user123', email: 'test@example.com' },
        memberships: [],
      });
    });

    it('should throw UnauthorizedException when no refresh token provided', async () => {
      const mockRequestWithoutToken = {
        headers: { 'x-client-type': 'web' },
        cookies: {},
      } as any;

      await expect(controller.refreshToken(undefined, mockRequestWithoutToken, mockResponse)).rejects.toThrow('Refresh token is required');
    });

    it('should handle unauthorized refresh token', async () => {
      authServiceMock.refreshAccessToken.mockRejectedValue(new UnauthorizedException('Invalid refresh token'));
      authServiceMock.invalidateRefreshToken.mockResolvedValue(undefined);

      await expect(controller.refreshToken('invalid-token', mockRequest, mockResponse)).rejects.toThrow(UnauthorizedException);

      expect(authServiceMock.invalidateRefreshToken).toHaveBeenCalledWith('invalid-token');
    });
  });
});