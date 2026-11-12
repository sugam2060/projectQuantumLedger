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
import { EndpointAccessCatalogService } from '../../roles-permissions/endpoint-access-catalog.service';

describe('UserAuthService', () => {
  let service: UserAuthService;
  let dbMock: any;
  let jwtServiceMock: any;
  let utilsServiceMock: any;
  let redisServiceMock: any;
  let endpointCatalogMock: { list: jest.Mock };

  beforeEach(async () => {
    // Mock dependencies
    dbMock = {
      transaction: jest.fn(),
      transactionWithSession: jest.fn(),
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
    endpointCatalogMock = {
      list: jest
        .fn()
        .mockReturnValue([
          { endpointKey: 'inventory.create' },
          { endpointKey: 'inventory.delete' },
          { endpointKey: 'catalog.view' },
        ]),
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
        {
          provide: EndpointAccessCatalogService,
          useValue: endpointCatalogMock,
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

  describe('getCurrentUser', () => {
    const authenticatedUser = {
      userId: '00000000-0000-4000-8000-000000000001',
      businessId: '00000000-0000-4000-8000-000000000002',
      branchId: '00000000-0000-4000-8000-000000000003',
      isOwner: false,
      isPlatform: false,
      permissions: [],
      tokenIssuedAt: 1_800_000_000,
      tokenExpiresAt: 1_800_000_900,
    };

    it('returns profile, active role permissions, and session context', async () => {
      const rows = [
        {
          userId: authenticatedUser.userId,
          displayName: 'Cashier One',
          status: 'active',
          membershipBusinessId: authenticatedUser.businessId,
          membershipBranchId: authenticatedUser.branchId,
          isOwner: false,
          roleId: '00000000-0000-4000-8000-000000000004',
          roleName: 'Cashier',
          roleVersion: 3,
          rolePermissions: ['products.read'],
          endpointKey: 'inventory.create',
          configuredRoleId: '00000000-0000-4000-8000-000000000004',
          terminalId: '00000000-0000-4000-8000-000000000005',
        },
        {
          userId: authenticatedUser.userId,
          displayName: 'Cashier One',
          status: 'active',
          membershipBusinessId: authenticatedUser.businessId,
          membershipBranchId: authenticatedUser.branchId,
          isOwner: false,
          roleId: '00000000-0000-4000-8000-000000000004',
          roleName: 'Cashier',
          roleVersion: 3,
          rolePermissions: ['products.read'],
          endpointKey: 'inventory.delete',
          configuredRoleId: '00000000-0000-4000-8000-000000000006',
          terminalId: '00000000-0000-4000-8000-000000000005',
        },
      ];
      const query = {
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(rows),
      };
      const tx = { select: jest.fn().mockReturnValue(query) };
      dbMock.transactionWithSession.mockImplementation(
        async (
          _session: unknown,
          callback: (transaction: unknown) => unknown,
        ) => callback(tx),
      );

      await expect(
        service.getCurrentUser(
          authenticatedUser,
          ClientType.WEB,
          '00000000-0000-4000-8000-000000000005',
        ),
      ).resolves.toEqual({
        id: authenticatedUser.userId,
        displayName: 'Cashier One',
        activeContext: {
          businessId: authenticatedUser.businessId,
          branchId: authenticatedUser.branchId,
        },
        is_owner: false,
        role_template: '00000000-0000-4000-8000-000000000004',
        role_template_version: '3',
        effectivePermissions: [
          'catalog.view',
          'inventory.create',
          'products.read',
        ],
        session: {
          clientType: ClientType.WEB,
          terminalId: '00000000-0000-4000-8000-000000000005',
          issuedAt: new Date(1_800_000_000_000).toISOString(),
          expiresAt: new Date(1_800_000_900_000).toISOString(),
          expiresInSeconds: expect.any(Number),
        },
      });
      expect(dbMock.transactionWithSession).toHaveBeenCalledWith(
        authenticatedUser,
        expect.any(Function),
      );
      expect(tx.select).toHaveBeenCalledTimes(1);
    });

    it('rejects platform tokens on the user profile endpoint', async () => {
      await expect(
        service.getCurrentUser(
          { isPlatform: true, permissions: [] },
          ClientType.MOBILE,
          '00000000-0000-4000-8000-000000000005',
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(dbMock.transactionWithSession).not.toHaveBeenCalled();
    });
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
