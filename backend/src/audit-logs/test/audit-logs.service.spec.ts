import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { AuditLogsRepository } from '../audit-logs.repository';
import { AuditLogsService } from '../audit-logs.service';
import { DatabaseService } from '../../database/database.service';

describe('AuditLogsService', () => {
  const database = { transactionWithSession: jest.fn() };
  const service = new AuditLogsService(
    new AuditLogsRepository(database as unknown as DatabaseService),
  );

  beforeEach(() => jest.clearAllMocks());

  it('writes user endpoint context and actor to access logs', async () => {
    const values = jest.fn().mockResolvedValue(undefined);
    const tx = { insert: jest.fn().mockReturnValue({ values }) };

    await service.insertUserEvent(tx as never, {
      eventType: 'USER_LOGIN_SUCCESS',
      userId: 'user-id',
      businessId: 'business-id',
      method: 'POST',
      endpointPath: '/authentication/login',
      responseStatus: 200,
      requestId: 'request-id',
      clientType: 'desktop',
      terminalId: 'terminal-id',
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id',
        businessId: 'business-id',
        eventType: 'USER_LOGIN_SUCCESS',
        httpMethod: 'POST',
        endpointPath: '/authentication/login',
        responseStatus: 200,
        requestId: 'request-id',
        clientType: 'desktop',
        terminalId: 'terminal-id',
      }),
    );
  });

  it('uses a platform RLS session for platform audit records', async () => {
    const tx = { insert: jest.fn().mockReturnValue({ values: jest.fn() }) };
    database.transactionWithSession.mockImplementation(
      async (_session, callback) => callback(tx),
    );

    await service.logPlatformEvent({
      platformUserId: 'platform-user-id',
      action: 'platform.login.succeeded',
      method: 'POST',
      endpointPath: '/platform/user/login',
      responseStatus: 200,
    });

    expect(database.transactionWithSession).toHaveBeenCalledWith(
      { isPlatform: true, platformUserId: 'platform-user-id' },
      expect.any(Function),
    );
  });

  it('never throws when a standalone audit write fails', async () => {
    database.transactionWithSession.mockRejectedValue(new Error('db down'));

    await expect(
      service.logUserEvent({ userId: 'u' }, { eventType: 'USER_LOGIN_FAILED' }),
    ).resolves.toBeUndefined();
  });
});
