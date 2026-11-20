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
import { EndpointAccessCatalogService } from '../../roles-permissions/endpoint-access-catalog.service';
import { EffectivePermissionsCacheService } from '../../roles-permissions/effective-permissions-cache.service';
import { AuditLogService } from '../../database/audit-log.service';

describe('UserAuthService', () => {
  let service: UserAuthService;
  let dbMock: any;
  let jwtServiceMock: any;
  let utilsServiceMock: any;
  let redisServiceMock: any;
  let endpointCatalogMock: { list: jest.Mock };
  let permissionsCacheMock: {
    get: jest.Mock;
    set: jest.Mock;
    invalidate: jest.Mock;
  };
  const auditLogsMock = {
    insertUserEvent: jest.fn().mockResolvedValue(undefined),
    logUserEvent: jest.fn().mockResolvedValue(undefined),
  };

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
    permissionsCacheMock = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
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
        {
          provide: EffectivePermissionsCacheService,
          useValue: permissionsCacheMock,
        },
        { provide: AuditLogService, useValue: auditLogsMock },
      ],
    }).compile();

    service = module.get<UserAuthService>(UserAuthService);

    // Clear all mocks before each test
    jest.clearAllMocks();
    auditLogsMock.insertUserEvent.mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getCurrentUser', () => {
    const authenticatedUser = {
      subjectId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000001',
      businessId: '00000000-0000-4000-8000-000000000002',
      branchId: '00000000-0000-4000-8000-000000000003',
      name: 'Cashier One',
      roleId: '00000000-0000-4000-8000-000000000004',
      roleVersion: 3,
      isOwner: false,
      isPlatform: false,
      permissions: [],
      tokenIssuedAt: 1_800_000_000,
      tokenExpiresAt: 1_800_000_900,
    };

    it('returns permissions from cache on initial load and profile from JWT claims', async () => {
      permissionsCacheMock.get.mockResolvedValue({
        permissions: ['products.read'],
        roleVersion: 3,
      });
      await expect(
        service.getCurrentUser(
          authenticatedUser,
          ClientType.WEB,
          '00000000-0000-4000-8000-000000000005',
        ),
      ).resolves.toEqual({
        user: {
          id: authenticatedUser.userId,
          name: authenticatedUser.name,
        },
        activeContext: {
          businessId: authenticatedUser.businessId,
          branchId: authenticatedUser.branchId,
        },
        is_owner: false,
        role_template: authenticatedUser.roleId,
        role_template_version: '3',
        effectivePermissions: ['products.read'],
        session: {
          clientType: ClientType.WEB,
          terminalId: '00000000-0000-4000-8000-000000000005',
          issuedAt: new Date(1_800_000_000_000).toISOString(),
          expiresAt: new Date(1_800_000_900_000).toISOString(),
          expiresInSeconds: expect.any(Number),
        },
      });
      expect(permissionsCacheMock.get).toHaveBeenCalledWith(
        authenticatedUser.businessId,
        authenticatedUser.roleId,
      );
      expect(dbMock.transactionWithSession).not.toHaveBeenCalled();
    });

    it('omits permissions and avoids cache and database when initial load is false', async () => {
      const result = await service.getCurrentUser(
        authenticatedUser,
        ClientType.WEB,
        '00000000-0000-4000-8000-000000000005',
        false,
      );
      expect(result).not.toHaveProperty('effectivePermissions');
      expect(result).toMatchObject({
        user: {
          id: authenticatedUser.userId,
          name: authenticatedUser.name,
        },
      });
      expect(permissionsCacheMock.get).not.toHaveBeenCalled();
      expect(dbMock.transactionWithSession).not.toHaveBeenCalled();
    });

    it('loads permissions from the database and populates cache on cache miss', async () => {
      const roleQuery = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest
          .fn()
          .mockResolvedValue([{ permissions: ['products.read'], version: 4 }]),
      };
      const endpointQuery = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([]),
      };
      const tx = {
        select: jest
          .fn()
          .mockReturnValueOnce(roleQuery)
          .mockReturnValueOnce(endpointQuery),
      };
      dbMock.transactionWithSession.mockImplementation(
        async (_session: unknown, callback: (tx: unknown) => unknown) =>
          callback(tx),
      );

      const result = await service.getCurrentUser(
        authenticatedUser,
        ClientType.WEB,
        '00000000-0000-4000-8000-000000000005',
      );

      expect(result.effectivePermissions).toEqual([
        'catalog.view',
        'inventory.create',
        'inventory.delete',
        'products.read',
      ]);
      expect(result.role_template_version).toBe('4');
      expect(dbMock.transactionWithSession).toHaveBeenCalledWith(
        authenticatedUser,
        expect.any(Function),
      );
      expect(permissionsCacheMock.set).toHaveBeenCalledWith(
        authenticatedUser.businessId,
        authenticatedUser.roleId,
        {
          permissions: [
            'catalog.view',
            'inventory.create',
            'inventory.delete',
            'products.read',
          ],
          roleVersion: 4,
        },
      );
    });

    it('uses the supplied terminal header as session metadata without querying the database', async () => {
      const result = await service.getCurrentUser(
        authenticatedUser,
        ClientType.WEB,
        '00000000-0000-4000-8000-000000000099',
        false,
      );

      expect(result.session.terminalId).toBe(
        '00000000-0000-4000-8000-000000000099',
      );
      expect(dbMock.transactionWithSession).not.toHaveBeenCalled();
    });

    it('rejects platform tokens on the user profile endpoint', async () => {
      await expect(
        service.getCurrentUser(
          {
            subjectId: '00000000-0000-4000-8000-000000000006',
            isPlatform: true,
            permissions: [],
          },
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

      await expect(
        service.userLogin(invalidDto, 'terminal123'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.userLogin(invalidDto, 'terminal123'),
      ).rejects.toThrow('Valid email is required');
    });

    it('should throw BadRequestException if password is missing', async () => {
      const invalidDto: any = { ...mockDto, password: undefined };

      await expect(
        service.userLogin(invalidDto, 'terminal123'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.userLogin(invalidDto, 'terminal123'),
      ).rejects.toThrow('Valid password is required');
    });

    it('should throw BadRequestException if email is not a string', async () => {
      const invalidDto = { ...mockDto, email: 123 as any };

      await expect(
        service.userLogin(invalidDto, 'terminal123'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.userLogin(invalidDto, 'terminal123'),
      ).rejects.toThrow('Valid email is required');
    });

    it('should throw BadRequestException if password is not a string', async () => {
      const invalidDto = { ...mockDto, password: 123 as any };

      await expect(
        service.userLogin(invalidDto, 'terminal123'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.userLogin(invalidDto, 'terminal123'),
      ).rejects.toThrow('Valid password is required');
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

      await expect(service.userLogin(mockDto, 'terminal123')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.userLogin(mockDto, 'terminal123')).rejects.toThrow(
        'Invalid email or password',
      );
    });

    it('should authenticate only when an active terminal matches a membership business and branch', async () => {
      // Mock user data that would be returned from the database
      const mockUserData = [
        {
          userId: 'user123',
          userEmail: 'test@example.com',
          userName: 'Test User',
          userPasswordHash: '$2a$10$hashedPassword',
          userStatus: 'active',
          businessId: 'business123',
          branchId: null,
          roleId: 'role123',
          roleVersion: 4,
          isOwner: false,
          roleName: 'admin',
          rolePermissions: ['read', 'write'],
        },
      ];

      // Mock the transaction to return user data
      dbMock.transaction.mockImplementation(async (callback: any) => {
        const userQuery = {
          from: jest.fn().mockReturnThis(),
          leftJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue(mockUserData),
        };
        const terminalQuery = {
          from: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([
            {
              terminalId: 'terminal123',
              businessId: 'business123',
              branchId: 'branch123',
            },
          ]),
        };
        const configurationsQuery = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([]),
        };
        const tx = {
          execute: jest.fn().mockResolvedValue(undefined),
          select: jest
            .fn()
            .mockReturnValueOnce(userQuery)
            .mockReturnValueOnce(terminalQuery)
            .mockReturnValueOnce(configurationsQuery),
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

      const result = await service.userLogin(mockDto, 'terminal123');

      expect(auditLogsMock.insertUserEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: 'user123',
          businessId: 'business123',
          terminalId: 'terminal123',
          eventType: 'USER_LOGIN_SUCCESS',
          responseStatus: 200,
        }),
      );

      expect(result).toEqual({
        accessToken: 'mock-jwt-token',
        refreshToken: 'mock-refresh-token',
        tokenType: 'Bearer',
        expiresIn: '7d',
        user: {
          id: 'user123',
          email: 'test@example.com',
          name: 'Test User',
        },
        memberships: expect.any(Array),
        effectivePermissions: expect.arrayContaining([
          'catalog.view',
          'inventory.create',
          'inventory.delete',
          'read',
          'write',
        ]),
      });

      expect(jwtServiceMock.signAsync).toHaveBeenCalled();
      expect(jwtServiceMock.signAsync.mock.calls[0][0]).toMatchObject({
        name: 'Test User',
        businessId: 'business123',
        branchId: 'branch123',
        role_id: 'role123',
        role_version: 4,
      });
      expect(jwtServiceMock.signAsync.mock.calls[0][0]).not.toHaveProperty(
        'userId',
      );
      expect(jwtServiceMock.signAsync.mock.calls[0][0]).not.toHaveProperty(
        'email',
      );
      expect(jwtServiceMock.signAsync.mock.calls[0][0]).not.toHaveProperty(
        'permissions',
      );
      expect(jwtServiceMock.signAsync.mock.calls[0][0]).not.toHaveProperty(
        'role',
      );
      expect(jwtServiceMock.signAsync.mock.calls[0][0]).not.toHaveProperty(
        'terminalId',
      );
      expect(utilsServiceMock.generateRefreshToken).toHaveBeenCalled();
      expect(redisServiceMock.set).toHaveBeenCalledWith(
        `refresh_token:mock-refresh-token`,
        'user123',
        7 * 24 * 60 * 60,
      );
    });

    it('authenticates an owner with a null membership branch and no role claims', async () => {
      const ownerDto: ClientLoginDTO = {
        email: 'owner@example.com',
        password: 'password123',
        remember: false,
      };
      const userQuery = {
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          {
            userId: 'owner-user',
            userEmail: 'owner@example.com',
            userName: 'Business Owner',
            userPasswordHash: '$2a$10$hashedPassword',
            userStatus: 'active',
            businessId: 'business123',
            branchId: null,
            isOwner: true,
            roleId: null,
            roleName: null,
            roleVersion: null,
            rolePermissions: null,
          },
        ]),
      };
      const terminalQuery = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          {
            terminalId: 'terminal123',
            businessId: 'business123',
            branchId: 'branch123',
          },
        ]),
      };
      dbMock.transaction.mockImplementation(async (callback: any) =>
        callback({
          execute: jest.fn().mockResolvedValue(undefined),
          select: jest
            .fn()
            .mockReturnValueOnce(userQuery)
            .mockReturnValueOnce(terminalQuery),
        }),
      );
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      jwtServiceMock.signAsync.mockResolvedValue('owner-access-token');

      const result = await service.userLogin(ownerDto, 'terminal123');

      expect(result).toMatchObject({
        accessToken: 'owner-access-token',
        effectivePermissions: [],
        memberships: [
          expect.objectContaining({
            businessId: 'business123',
            branchId: null,
            isOwner: true,
            roleId: null,
          }),
        ],
      });
      expect(jwtServiceMock.signAsync.mock.calls[0][0]).toMatchObject({
        isOwner: true,
        businessId: 'business123',
        branchId: 'branch123',
      });
      expect(jwtServiceMock.signAsync.mock.calls[0][0]).not.toHaveProperty(
        'role_id',
      );
      expect(permissionsCacheMock.set).not.toHaveBeenCalled();
    });

    it('rejects login when terminal is not active for a matching membership', async () => {
      const mockUserData = [
        {
          userId: 'user123',
          userEmail: 'test@example.com',
          userPasswordHash: '$2a$10$hashedPassword',
          userStatus: 'active',
          businessId: 'business123',
          branchId: 'branch123',
          roleId: 'role123',
          roleName: 'admin',
          rolePermissions: ['read'],
        },
      ];
      const userQuery = {
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(mockUserData),
      };
      const terminalQuery = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([]),
      };
      const configurationsQuery = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([]),
      };
      dbMock.transaction.mockImplementation(async (callback: any) =>
        callback({
          execute: jest.fn().mockResolvedValue(undefined),
          select: jest
            .fn()
            .mockReturnValueOnce(userQuery)
            .mockReturnValueOnce(terminalQuery)
            .mockReturnValueOnce(configurationsQuery),
        }),
      );
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await expect(service.userLogin(mockDto, 'terminal123')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(jwtServiceMock.signAsync).not.toHaveBeenCalled();
    });

    it('rejects login when an active terminal belongs to another business or branch', async () => {
      const mockUserData = [
        {
          userId: 'user123',
          userEmail: 'test@example.com',
          userPasswordHash: '$2a$10$hashedPassword',
          userStatus: 'active',
          businessId: 'business123',
          branchId: 'branch123',
          roleId: 'role123',
          roleName: 'admin',
          rolePermissions: ['read'],
        },
      ];
      const userQuery = {
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(mockUserData),
      };
      const terminalQuery = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          {
            terminalId: 'terminal123',
            businessId: 'different-business',
            branchId: 'different-branch',
          },
        ]),
      };
      const configurationsQuery = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([]),
      };
      dbMock.transaction.mockImplementation(async (callback: any) =>
        callback({
          execute: jest.fn().mockResolvedValue(undefined),
          select: jest
            .fn()
            .mockReturnValueOnce(userQuery)
            .mockReturnValueOnce(terminalQuery)
            .mockReturnValueOnce(configurationsQuery),
        }),
      );
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await expect(service.userLogin(mockDto, 'terminal123')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(jwtServiceMock.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('registerOwner', () => {
    it('creates a business-wide owner membership, activates business, and consumes the code', async () => {
      const makeQuery = (rows: object[], lockable = false) => {
        const query = {
          from: jest.fn(),
          where: jest.fn(),
          limit: jest.fn(),
          for: jest.fn().mockResolvedValue(rows),
        };
        query.from.mockReturnValue(query);
        query.where.mockReturnValue(query);
        query.limit.mockReturnValue(lockable ? query : Promise.resolve(rows));
        return query;
      };
      const insertedValues: unknown[] = [];
      const tx = {
        execute: jest.fn().mockResolvedValue(undefined),
        select: jest
          .fn()
          .mockReturnValueOnce(
            makeQuery(
              [
                {
                  id: 'redemption-id',
                  businessId: 'business-id',
                  email: 'owner@example.com',
                },
              ],
              true,
            ),
          )
          .mockReturnValueOnce(
            makeQuery([{ id: 'business-id', isActive: false }]),
          )
          .mockReturnValueOnce(makeQuery([]))
          .mockReturnValueOnce(
            makeQuery([{ terminalId: 'terminal-id', branchId: 'branch-id' }]),
          ),
        insert: jest
          .fn()
          .mockImplementationOnce(() => ({
            values: () => ({
              returning: jest
                .fn()
                .mockResolvedValue([{ id: 'created-owner-id' }]),
            }),
          }))
          .mockImplementationOnce(() => ({
            values: (value: unknown) => {
              insertedValues.push(value);
              return Promise.resolve([]);
            },
          })),
        update: jest.fn().mockImplementation(() => ({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        })),
      };
      dbMock.transactionWithSession.mockImplementation(
        async (
          _session: unknown,
          callback: (transaction: unknown) => unknown,
        ) => callback(tx),
      );

      const result = await service.registerOwner({
        email: ' OWNER@example.com ',
        name: 'Business Owner',
        password: 'secure-password',
        redeemCode: 'AABBCCDDEEFF001122334455',
        businessId: 'business-id',
        branchId: 'branch-id',
        terminalCode: 'POS-A1B2C3D4E5F60718',
      });

      expect(result).toMatchObject({
        userId: 'created-owner-id',
        businessId: 'business-id',
        isOwner: true,
        roleId: null,
        branchId: null,
        initialTerminalId: 'terminal-id',
        initialBranchId: 'branch-id',
      });
      expect(insertedValues[0]).toMatchObject({
        businessId: 'business-id',
        userId: 'created-owner-id',
        roleId: null,
        branchId: null,
        isOwner: true,
        isActive: true,
      });
      expect(tx.update).toHaveBeenCalledTimes(3);
      expect(tx.execute).toHaveBeenCalledTimes(4);
    });

    it('rejects a redemption code that is not visible or no longer redeemable', async () => {
      const query = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        for: jest.fn().mockResolvedValue([]),
      };
      const tx = {
        execute: jest.fn().mockResolvedValue(undefined),
        select: jest.fn().mockReturnValue(query),
        insert: jest.fn(),
      };
      dbMock.transactionWithSession.mockImplementation(
        async (
          _session: unknown,
          callback: (transaction: unknown) => unknown,
        ) => callback(tx),
      );

      await expect(
        service.registerOwner({
          email: 'owner@example.com',
          name: 'Business Owner',
          password: 'secure-password',
          redeemCode: 'INVALID',
          businessId: 'business-id',
          branchId: 'branch-id',
          terminalCode: 'POS-A1B2C3D4E5F60718',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(tx.insert).not.toHaveBeenCalled();
    });

    it('requires the password to attach an existing global account', async () => {
      const makeQuery = (rows: object[], lockable = false) => {
        const query = {
          from: jest.fn(),
          where: jest.fn(),
          limit: jest.fn(),
          for: jest.fn().mockResolvedValue(rows),
        };
        query.from.mockReturnValue(query);
        query.where.mockReturnValue(query);
        query.limit.mockReturnValue(lockable ? query : Promise.resolve(rows));
        return query;
      };
      const tx = {
        execute: jest.fn().mockResolvedValue(undefined),
        select: jest
          .fn()
          .mockReturnValueOnce(
            makeQuery(
              [
                {
                  id: 'redemption-id',
                  businessId: 'business-id',
                  email: 'owner@example.com',
                },
              ],
              true,
            ),
          )
          .mockReturnValueOnce(
            makeQuery([{ id: 'business-id', isActive: false }]),
          )
          .mockReturnValueOnce(
            makeQuery([
              {
                id: 'existing-user-id',
                passwordHash: 'stored-password-hash',
                status: 'active',
              },
            ]),
          )
          .mockReturnValueOnce(
            makeQuery([{ terminalId: 'terminal-id', branchId: 'branch-id' }]),
          ),
        insert: jest.fn(() => ({ values: jest.fn().mockResolvedValue([]) })),
        update: jest.fn(() => ({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        })),
      };
      dbMock.transactionWithSession.mockImplementation(
        async (
          _session: unknown,
          callback: (transaction: unknown) => unknown,
        ) => callback(tx),
      );
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.registerOwner({
        email: 'owner@example.com',
        name: 'Owner Name',
        password: 'existing-password',
        redeemCode: 'AABBCCDDEEFF001122334455',
        businessId: 'business-id',
        branchId: 'branch-id',
        terminalCode: 'POS-A1B2C3D4E5F60718',
      });

      expect(bcrypt.compare).toHaveBeenCalledWith(
        'existing-password',
        'stored-password-hash',
      );
      expect(tx.insert).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        userId: 'existing-user-id',
        isOwner: true,
        roleId: null,
        branchId: null,
      });
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
        service.refreshAccessToken(mockRefreshToken, 'terminal123'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should successfully refresh access token', async () => {
      // Mock Redis response
      redisServiceMock.get.mockResolvedValue('user123');

      const userQuery = {
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        leftJoinAgain: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          {
            userId: 'user123',
            email: 'test@example.com',
            name: 'Test User',
            status: 'active',
            businessId: 'business123',
            branchId: 'branch123',
            isOwner: false,
            roleId: 'role123',
            roleVersion: 4,
            permissions: ['products.read'],
          },
        ]),
      };
      userQuery.leftJoin.mockReturnValue(userQuery);
      const terminalQuery = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          {
            terminalId: 'terminal123',
            businessId: 'business123',
            branchId: 'branch123',
          },
        ]),
      };
      const configurationsQuery = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([]),
      };
      dbMock.transaction.mockImplementation(async (callback: any) =>
        callback({
          execute: jest.fn().mockResolvedValue(undefined),
          select: jest
            .fn()
            .mockReturnValueOnce(userQuery)
            .mockReturnValueOnce(terminalQuery)
            .mockReturnValueOnce(configurationsQuery),
        }),
      );

      // Mock JWT and token generation
      jwtServiceMock.signAsync.mockResolvedValue('new-access-token');
      utilsServiceMock.generateRefreshToken.mockReturnValue(
        'new-refresh-token',
      );
      redisServiceMock.set.mockResolvedValue(undefined);
      redisServiceMock.delete.mockResolvedValue(undefined);

      const result = await service.refreshAccessToken(
        mockRefreshToken,
        'terminal123',
      );

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
        effectivePermissions: expect.arrayContaining([
          'catalog.view',
          'inventory.create',
          'inventory.delete',
          'products.read',
        ]),
      });
      expect(jwtServiceMock.signAsync.mock.calls[0][0]).toMatchObject({
        name: 'Test User',
        businessId: 'business123',
        branchId: 'branch123',
        role_id: 'role123',
        role_version: 4,
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

    it('refreshes a roleless owner without adding a branch assignment or role claim', async () => {
      redisServiceMock.get.mockResolvedValue('owner-user');
      const userQuery = {
        from: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          {
            userId: 'owner-user',
            email: 'owner@example.com',
            name: 'Business Owner',
            status: 'active',
            businessId: 'business123',
            branchId: null,
            isOwner: true,
            roleId: null,
            roleVersion: null,
            permissions: null,
          },
        ]),
      };
      const terminalQuery = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          {
            terminalId: 'terminal123',
            businessId: 'business123',
            branchId: 'branch123',
          },
        ]),
      };
      dbMock.transaction.mockImplementation(async (callback: any) =>
        callback({
          execute: jest.fn().mockResolvedValue(undefined),
          select: jest
            .fn()
            .mockReturnValueOnce(userQuery)
            .mockReturnValueOnce(terminalQuery),
        }),
      );
      jwtServiceMock.signAsync.mockResolvedValue('owner-access-token');
      utilsServiceMock.generateRefreshToken.mockReturnValue(
        'owner-new-refresh',
      );
      redisServiceMock.set.mockResolvedValue(undefined);
      redisServiceMock.delete.mockResolvedValue(undefined);

      await expect(
        service.refreshAccessToken(mockRefreshToken, 'terminal123'),
      ).resolves.toMatchObject({
        accessToken: 'owner-access-token',
        effectivePermissions: [],
        user: { id: 'owner-user', email: 'owner@example.com' },
      });
      expect(jwtServiceMock.signAsync.mock.calls[0][0]).toMatchObject({
        isOwner: true,
        businessId: 'business123',
        branchId: 'branch123',
      });
      expect(jwtServiceMock.signAsync.mock.calls[0][0]).not.toHaveProperty(
        'role_id',
      );
      expect(permissionsCacheMock.set).not.toHaveBeenCalled();
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

    it('only invalidates a refresh token owned by the authenticated user', async () => {
      redisServiceMock.compareAndDelete = jest.fn().mockResolvedValue(true);

      await service.invalidateRefreshTokenForSession(
        mockRefreshToken,
        'user-id',
      );

      expect(redisServiceMock.compareAndDelete).toHaveBeenCalledWith(
        `refresh_token:${mockRefreshToken}`,
        'user-id',
      );
    });
  });
});
