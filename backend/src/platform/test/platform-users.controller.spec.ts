import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { ForbiddenException } from '@nestjs/common';
import { RATE_LIMIT_KEY } from '../../authentication/decorators/rate-limit.decorator';
import { PlatformUsersController } from '../platform-users.controller';
import { PlatformUsersService } from '../platform-users.service';

describe('PlatformUsersController', () => {
  const invitations = { invitePlatformUser: jest.fn() };
  const controller = new PlatformUsersController(
    invitations as unknown as PlatformUsersService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('delegates an authenticated platform-user invitation', async () => {
    expect(
      Reflect.getMetadata(
        RATE_LIMIT_KEY,
        PlatformUsersController.prototype.invite,
      ),
    ).toEqual(expect.objectContaining({ requests: 20, windowMs: 60 * 60_000 }));
    invitations.invitePlatformUser.mockResolvedValue({
      message: 'Invite sent to Jane Manager',
    });
    await expect(
      controller.invite(
        { name: 'Jane Manager', email: 'jane@example.com' },
        { clientType: 'web', idempotencyKey: 'key-1' },
        {
          user: {
            isPlatform: true,
            platformUserId: 'platform-user-id',
            name: 'Admin',
          },
        } as never,
      ),
    ).resolves.toEqual({ message: 'Invite sent to Jane Manager' });
    expect(invitations.invitePlatformUser).toHaveBeenCalledWith(
      { name: 'Jane Manager', email: 'jane@example.com' },
      'key-1',
      'platform-user-id',
      'Admin',
    );
  });

  it('rejects non-platform users', async () => {
    await expect(
      controller.invite(
        { name: 'Jane Manager', email: 'jane@example.com' },
        { clientType: 'web', idempotencyKey: 'key-1' },
        { user: { isPlatform: false, platformUserId: 'user-id' } } as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(invitations.invitePlatformUser).not.toHaveBeenCalled();
  });
});
