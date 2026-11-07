import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { Test, TestingModule } from '@nestjs/testing';
import { UserAuthService } from '../authentication.service.user';
import { DatabaseService } from '../../database/database.service';
import { JwtService } from '@nestjs/jwt';
import { UtilsService } from '../../utils/utils.service';
import { RedisService } from '../../redis/redis.service';
import { ClientLoginDTO, ClientType } from '../dto/clientLogin.dto';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';

describe('UserAuthService', () => {
  let service: UserAuthService;
  let dbMock: any;
  let jwtServiceMock: any;
  let utilsServiceMock: any;
  let redisServiceMock: any;

  beforeEach(async () => {
    // Mock dependencies
    dbMock = {
      transaction: jest.fn(),
      execute: jest.fn(),
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue([]),
            }),
          }),
        }),
      }),
    };

    jwtServiceMock = {
      signAsync: jest.fn(),
    };

    utilsServiceMock = {
      generateRefreshToken: jest.fn(),
    };

    redisServiceMock = {
      set: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserAuthService,
        {
          provide: DatabaseService,
          useValue: dbMock,
        },
        {
          provide: JwtService,
          useValue: jwtServiceMock,
        },
        {
          provide: UtilsService,
          useValue: utilsServiceMock,
        },
        {
          provide: RedisService,
          useValue: redisServiceMock,
        },
      ],
    }).compile();

    service = module.get<UserAuthService>(UserAuthService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('userLogin', () => {
    const mockDto: ClientLoginDTO = {
      email: 'test@example.com',
      password: 'password123',
      remember: true,
    };

    beforeEach(() => {
      // Reset mocks
      jest.clearAllMocks();
    });

    it('should throw BadRequestException if email is missing', async () => {
      const invalidDto: any = { ...mockDto, email: undefined };

      await expect(service.userLogin(invalidDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.userLogin(invalidDto)).rejects.toThrow(
        'Valid email is required',
      );
    });

    it('should throw BadRequestException if password is missing', async () => {
      const invalidDto: any = { ...mockDto, password: undefined };

      await expect(service.userLogin(invalidDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.userLogin(invalidDto)).rejects.toThrow(
        'Valid password is required',
      );
    });

    it('should throw BadRequestException if email is not a string', async () => {
      const invalidDto = { ...mockDto, email: 123 as any };

      await expect(service.userLogin(invalidDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.userLogin(invalidDto)).rejects.toThrow(
        'Valid email is required',
      );
    });

    it('should throw BadRequestException if password is not a string', async () => {
      const invalidDto = { ...mockDto, password: 123 as any };

      await expect(service.userLogin(invalidDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.userLogin(invalidDto)).rejects.toThrow(
        'Valid password is required',
      );
    });

    it('should throw UnauthorizedException for invalid credentials when no user found', async () => {
      // Mock the transaction to return empty results
      dbMock.transaction.mockImplementation(async (callback: any) => {
        const tx = {
          execute: jest.fn().mockResolvedValue(undefined),
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              leftJoin: jest.fn().mockReturnValue({
                leftJoin: jest.fn().mockReturnValue({
                  where: jest.fn().mockReturnValue([]),
                }),
              }),
            }),
          }),
        };
        return callback(tx);
      });

      await expect(service.userLogin(mockDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.userLogin(mockDto)).rejects.toThrow(
        'Invalid email or password',
      );
    });

    it('should successfully authenticate user and return tokens', async () => {
      // Mock user data that would be returned from the database
      const mockUserData = [
        {
          userId: 'user123',
          userEmail: 'test@example.com',
          userPasswordHash: '$2a$10$hashedPassword',
          userStatus: 'active',
          businessId: 'business123',
          roleId: 'role123',
          roleName: 'admin',
          rolePermissions: ['read', 'write'],
        },
      ];

      // Mock the transaction to return user data
      dbMock.transaction.mockImplementation(async (callback: any) => {
        const tx = {
          execute: jest.fn().mockResolvedValue(undefined),
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              leftJoin: jest.fn().mockReturnValue({
                leftJoin: jest.fn().mockReturnValue({
                  where: jest.fn().mockReturnValue(mockUserData),
                }),
              }),
            }),
          }),
        };
        return callback(tx);
      });

      // Mock bcrypt.compare to return true (valid password)
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);

      // Mock JWT service
      jwtServiceMock.signAsync.mockResolvedValue('mock-jwt-token');

      // Mock utils service
      utilsServiceMock.generateRefreshToken.mockReturnValue(
        'mock-refresh-token',
      );

      // Mock Redis service
      redisServiceMock.set.mockResolvedValue(undefined);

      const result = await service.userLogin(mockDto);

      expect(result).toEqual({
        accessToken: 'mock-jwt-token',
        refreshToken: 'mock-refresh-token',
        tokenType: 'Bearer',
        expiresIn: '7d',
        user: {
          id: 'user123',
          email: 'test@example.com',
          name: undefined,
        },
        memberships: expect.any(Array),
      });

      expect(jwtServiceMock.signAsync).toHaveBeenCalled();
      expect(utilsServiceMock.generateRefreshToken).toHaveBeenCalled();
      expect(redisServiceMock.set).toHaveBeenCalledWith(
        `refresh_token:mock-refresh-token`,
        'user123',
        7 * 24 * 60 * 60,
      );
    });
  });

  describe('refreshAccessToken', () => {
    const mockRefreshToken = 'valid-refresh-token';

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should throw UnauthorizedException for invalid refresh token', async () => {
      redisServiceMock.get.mockResolvedValue(null);

      await expect(
        service.refreshAccessToken(mockRefreshToken),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should successfully refresh access token', async () => {
      // Mock Redis response
      redisServiceMock.get.mockResolvedValue('user123');

      // Mock database responses
      dbMock.execute.mockResolvedValue(undefined);

      // Mock the select method to return user data
      dbMock.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                id: 'user123',
                emailNormalized: 'test@example.com',
                name: 'Test User',
                status: 'active',
              },
            ]),
          }),
        }),
      }));

      // Mock JWT and token generation
      jwtServiceMock.signAsync.mockResolvedValue('new-access-token');
      utilsServiceMock.generateRefreshToken.mockReturnValue(
        'new-refresh-token',
      );
      redisServiceMock.set.mockResolvedValue(undefined);
      redisServiceMock.delete.mockResolvedValue(undefined);

      const result = await service.refreshAccessToken(mockRefreshToken);

      expect(result).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        tokenType: 'Bearer',
        expiresIn: '15m',
        user: {
          id: 'user123',
          email: 'test@example.com',
          name: 'Test User',
        },
      });

      expect(redisServiceMock.delete).toHaveBeenCalledWith(
        `refresh_token:${mockRefreshToken}`,
      );
      expect(redisServiceMock.set).toHaveBeenCalledWith(
        `refresh_token:new-refresh-token`,
        'user123',
        7 * 24 * 60 * 60,
      );
    });
  });

  describe('invalidateRefreshToken', () => {
    const mockRefreshToken = 'valid-refresh-token';

    it('should invalidate refresh token', async () => {
      redisServiceMock.delete.mockResolvedValue(1);

      await service.invalidateRefreshToken(mockRefreshToken);

      expect(redisServiceMock.delete).toHaveBeenCalledWith(
        `refresh_token:${mockRefreshToken}`,
      );
    });
  });
});
