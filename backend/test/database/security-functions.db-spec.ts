import {
  createBranch,
  createBusiness,
  createBusinessWithOwner,
  createMembership,
  createPlatformUser,
  createRole,
  createTerminal,
  createUser,
} from './helpers/factories';
import { asApp, closePools, owner, truncateAll } from './helpers/test-db';

type Row = Record<string, unknown>;

/** Calls `app.<fn>(args)` as fortis_app with the given request context. */
async function call(
  settings: Record<string, string>,
  fn: string,
  args: unknown[] = [],
): Promise<Row[]> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  return asApp(settings, async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT * FROM app.${fn}(${placeholders})`,
      args,
    );
    return rows;
  });
}

async function scalar(
  settings: Record<string, string>,
  fn: string,
  args: unknown[] = [],
): Promise<unknown> {
  const rows = await call(settings, fn, args);
  return Object.values(rows[0])[0];
}

describe('app.* security functions', () => {
  beforeEach(truncateAll);
  afterAll(closePools);

  describe('request context readers', () => {
    it('return the uuid that was set and NULL for missing or malformed values', async () => {
      const id = '00000000-0000-4000-8000-000000000001';
      expect(await scalar({ 'app.user_id': id }, 'current_user_id')).toBe(id);
      expect(await scalar({}, 'current_user_id')).toBeNull();
      expect(
        await scalar(
          { 'app.business_id': 'not-a-uuid' },
          'current_business_id',
        ),
      ).toBeNull();
    });
  });

  describe('membership predicates', () => {
    it('recognise an active platform user only', async () => {
      const active = await createPlatformUser();
      const disabled = await createPlatformUser({ status: 'disabled' });
      expect(
        await scalar({ 'app.platform_user_id': active.id }, 'is_platform_user'),
      ).toBe(true);
      expect(
        await scalar(
          { 'app.platform_user_id': disabled.id },
          'is_platform_user',
        ),
      ).toBe(false);
      expect(await scalar({}, 'is_platform_user')).toBe(false);
    });

    it('distinguish owner, branch member, business-wide member and outsider', async () => {
      const {
        businessId,
        branchId,
        owner: ownerUser,
      } = await createBusinessWithOwner();
      const otherBranch = await createBranch(businessId);
      const role = await createRole(businessId);
      const cashier = await createUser();
      await createMembership({
        businessId,
        userId: cashier.id,
        roleId: role,
        branchId,
      });
      const manager = await createUser();
      await createMembership({ businessId, userId: manager.id, roleId: role });
      const outsider = await createUser();
      const otherBusiness = await createBusiness();
      await createMembership({
        businessId: otherBusiness,
        userId: outsider.id,
        roleId: await createRole(otherBusiness),
      });

      const as = (userId: string) => ({ 'app.user_id': userId });

      expect(
        await scalar(as(ownerUser.id), 'is_business_owner', [businessId]),
      ).toBe(true);
      expect(
        await scalar(as(cashier.id), 'is_business_owner', [businessId]),
      ).toBe(false);

      expect(
        await scalar(as(cashier.id), 'is_business_member', [businessId]),
      ).toBe(true);
      expect(
        await scalar(as(outsider.id), 'is_business_member', [businessId]),
      ).toBe(false);

      expect(
        await scalar(as(cashier.id), 'can_access_branch', [
          businessId,
          branchId,
        ]),
      ).toBe(true);
      expect(
        await scalar(as(cashier.id), 'can_access_branch', [
          businessId,
          otherBranch,
        ]),
      ).toBe(false);
      expect(
        await scalar(as(manager.id), 'can_access_branch', [
          businessId,
          otherBranch,
        ]),
      ).toBe(true);
      expect(
        await scalar(as(ownerUser.id), 'can_access_branch', [
          businessId,
          otherBranch,
        ]),
      ).toBe(true);
    });

    it('ignore ended memberships and disabled users', async () => {
      const { businessId } = await createBusinessWithOwner();
      const role = await createRole(businessId);
      const ended = await createUser();
      await createMembership({
        businessId,
        userId: ended.id,
        roleId: role,
        isActive: false,
      });
      const disabled = await createUser({ status: 'disabled' });
      await createMembership({ businessId, userId: disabled.id, roleId: role });

      for (const userId of [ended.id, disabled.id]) {
        expect(
          await scalar({ 'app.user_id': userId }, 'is_business_member', [
            businessId,
          ]),
        ).toBe(false);
      }
    });
  });

  describe('pre-authentication lookups', () => {
    it('find a user by email case-insensitively without any request context', async () => {
      const user = await createUser({ email: 'mixed@fortis.test' });
      const rows = await call({}, 'auth_find_user_by_email', [
        ' MIXED@Fortis.Test ',
      ]);
      expect(rows).toEqual([
        expect.objectContaining({
          id: user.id,
          email: 'mixed@fortis.test',
          status: 'active',
          password_hash: expect.any(String),
        }),
      ]);
      expect(
        await call({}, 'auth_find_user_by_email', ['nobody@fortis.test']),
      ).toEqual([]);
    });

    it('find a platform user by email, and by id only for that platform user', async () => {
      const staff = await createPlatformUser({ email: 'staff@fortis.test' });
      const other = await createPlatformUser();
      expect(
        await call({}, 'auth_find_platform_user_by_email', [
          'STAFF@fortis.test',
        ]),
      ).toEqual([
        expect.objectContaining({ id: staff.id, is_bootstrap: false }),
      ]);

      const own = await call(
        { 'app.platform_user_id': staff.id },
        'auth_find_platform_user_by_id',
        [staff.id],
      );
      expect(own).toEqual([
        expect.objectContaining({
          email: 'staff@fortis.test',
          status: 'active',
        }),
      ]);
      expect(own[0]).not.toHaveProperty('password_hash');
      expect(
        await call(
          { 'app.platform_user_id': other.id },
          'auth_find_platform_user_by_id',
          [staff.id],
        ),
      ).toEqual([]);
    });

    it('return a user by id only to that user and without the hash', async () => {
      const user = await createUser();
      const other = await createUser();
      const own = await call(
        { 'app.user_id': user.id },
        'auth_find_user_by_id',
        [user.id],
      );
      expect(own).toEqual([expect.objectContaining({ id: user.id })]);
      expect(own[0]).not.toHaveProperty('password_hash');
      expect(
        await call({ 'app.user_id': other.id }, 'auth_find_user_by_id', [
          user.id,
        ]),
      ).toEqual([]);
      expect(await call({}, 'auth_find_user_by_id', [user.id])).toEqual([]);
    });

    it('list only the caller own active memberships of active businesses', async () => {
      const { businessId, owner: ownerUser } = await createBusinessWithOwner();
      const inactiveBusiness = await createBusiness({ isActive: false });
      await createMembership({
        businessId: inactiveBusiness,
        userId: ownerUser.id,
        isOwner: true,
        isActive: false,
      });
      const rows = await call(
        { 'app.user_id': ownerUser.id },
        'auth_list_active_memberships',
        [ownerUser.id],
      );
      expect(rows).toEqual([
        expect.objectContaining({ business_id: businessId, is_owner: true }),
      ]);
      const stranger = await createUser();
      expect(
        await call(
          { 'app.user_id': stranger.id },
          'auth_list_active_memberships',
          [ownerUser.id],
        ),
      ).toEqual([]);
    });

    it('find only active terminals', async () => {
      const { businessId, branchId, terminalId } =
        await createBusinessWithOwner();
      const inactive = await createTerminal(businessId, branchId, 'inactive');
      expect(await call({}, 'auth_find_active_terminal', [terminalId])).toEqual(
        [{ id: terminalId, business_id: businessId, branch_id: branchId }],
      );
      expect(await call({}, 'auth_find_active_terminal', [inactive])).toEqual(
        [],
      );
    });
  });

  describe('privileges', () => {
    it('lets fortis_app execute app functions but not PUBLIC', async () => {
      const { rows } = await owner().query<{ app: boolean; pub: boolean }>(
        `SELECT has_function_privilege('fortis_app', 'app.is_business_member(uuid)', 'EXECUTE') AS app,
                has_function_privilege('public', 'app.auth_find_user_by_email(text)', 'EXECUTE') AS pub`,
      );
      expect(rows).toEqual([{ app: true, pub: false }]);
    });

    it('pins search_path on every SECURITY DEFINER function', async () => {
      const { rows } = await owner().query<{ proname: string }>(
        `SELECT p.proname
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'app' AND p.prosecdef
            AND NOT EXISTS (
              SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'
            )`,
      );
      expect(rows).toEqual([]);
    });
  });
});
