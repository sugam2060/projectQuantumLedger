import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PERMISSION_KEYS } from '../../src/authorization';
import { createTestApp } from '../common/helpers/create-test-app';
import {
  createBranch,
  createBusinessWithOwner,
  createMembership,
  createPlatformUser,
  createRole,
  createTerminal,
  createUser,
  TEST_PASSWORD,
} from '../database/helpers/factories';
import {
  asApp,
  closePools,
  owner,
  truncateAll,
} from '../database/helpers/test-db';

const API = '/api/v1';

async function systemRole(key: string): Promise<string> {
  const { rows } = await owner().query<{ id: string }>(
    'SELECT id FROM roles WHERE business_id IS NULL AND key = $1',
    [key],
  );
  return rows[0].id;
}

/** app.has_permission evaluated as fortis_app for `userId`. */
function can(
  userId: string,
  businessId: string,
  permission: string,
  branchId: string | null = null,
): Promise<boolean> {
  return asApp({ 'app.user_id': userId }, async (client) => {
    const { rows } = await client.query<{ allowed: boolean }>(
      'SELECT app.has_permission($1, $2, $3) AS allowed',
      [businessId, branchId, permission],
    );
    return rows[0].allowed;
  });
}

async function override(
  businessId: string,
  userId: string,
  key: string,
  effect: 'allow' | 'deny',
) {
  await owner().query(
    `INSERT INTO member_permission_overrides (business_id, user_id, permission_key, effect)
     VALUES ($1, $2, $3, $4)`,
    [businessId, userId, key, effect],
  );
}

describe('authorization (real database)', () => {
  beforeEach(() => truncateAll());

  describe('catalogue', () => {
    afterAll(() => closePools());

    it('matches the Permission constant exactly', async () => {
      const { rows } = await owner().query<{ key: string }>(
        'SELECT key FROM permissions ORDER BY key',
      );
      expect(rows.map((row) => row.key)).toEqual([...PERMISSION_KEYS].sort());
    });

    it('seeds the read-only system roles with their grants', async () => {
      const { rows } = await owner().query<{ key: string; grants: number }>(
        `SELECT r.key, count(rp.permission_key)::int AS grants
           FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
          WHERE r.is_system GROUP BY r.key ORDER BY r.key`,
      );
      expect(rows).toEqual([
        { key: 'accountant', grants: 4 },
        { key: 'admin', grants: PERMISSION_KEYS.length },
        { key: 'branch-manager', grants: 12 },
        { key: 'cashier', grants: 3 },
        { key: 'inventory-manager', grants: 3 },
        { key: 'viewer', grants: 5 },
      ]);
    });

    it('does not let the runtime role change the catalogue or system roles', async () => {
      const { businessId, owner: boss } = await createBusinessWithOwner();
      const settings = {
        'app.user_id': boss.id,
        'app.business_id': businessId,
      };
      await expect(
        asApp(settings, (client) =>
          client.query(
            "INSERT INTO permissions (key, description) VALUES ('x:y', 'x')",
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      const admin = await systemRole('admin');
      await expect(
        asApp(settings, (client) =>
          client.query("UPDATE roles SET name = 'Hacked' WHERE id = $1", [
            admin,
          ]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      const cashier = await systemRole('cashier');
      await expect(
        asApp(settings, (client) =>
          client.query(
            "INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, 'audit:read')",
            [cashier],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('app.has_permission', () => {
    it('gives the owner every known permission and nothing unknown', async () => {
      const { businessId, owner: boss } = await createBusinessWithOwner();
      for (const key of PERMISSION_KEYS) {
        expect(await can(boss.id, businessId, key)).toBe(true);
      }
      expect(await can(boss.id, businessId, 'business:destroy')).toBe(false);
    });

    it('denies outsiders, ended memberships and disabled accounts', async () => {
      const { businessId } = await createBusinessWithOwner();
      const outsider = await createUser();
      expect(await can(outsider.id, businessId, 'business:read')).toBe(false);

      const former = await createUser();
      await createMembership({
        businessId,
        userId: former.id,
        roleId: await systemRole('admin'),
        isActive: false,
      });
      expect(await can(former.id, businessId, 'business:read')).toBe(false);

      const disabled = await createUser({ status: 'disabled' });
      await createMembership({
        businessId,
        userId: disabled.id,
        roleId: await systemRole('admin'),
      });
      expect(await can(disabled.id, businessId, 'business:read')).toBe(false);
    });

    it('follows the role grants', async () => {
      const { businessId } = await createBusinessWithOwner();
      const cashier = await createUser();
      await createMembership({
        businessId,
        userId: cashier.id,
        roleId: await systemRole('cashier'),
      });
      expect(await can(cashier.id, businessId, 'business:read')).toBe(true);
      expect(await can(cashier.id, businessId, 'business:update')).toBe(false);
      expect(await can(cashier.id, businessId, 'member:invite')).toBe(false);
    });

    it('applies deny over the role and allow beyond it', async () => {
      const { businessId } = await createBusinessWithOwner();
      const cashier = await createUser();
      await createMembership({
        businessId,
        userId: cashier.id,
        roleId: await systemRole('cashier'),
      });
      await override(businessId, cashier.id, 'business:read', 'deny');
      await override(businessId, cashier.id, 'audit:read', 'allow');
      expect(await can(cashier.id, businessId, 'business:read')).toBe(false);
      expect(await can(cashier.id, businessId, 'audit:read')).toBe(true);
    });

    it('limits branch members (and branch-level roles) to their branch', async () => {
      const { businessId, branchId } = await createBusinessWithOwner();
      const other = await createBranch(businessId);

      const manager = await createUser();
      await createMembership({
        businessId,
        userId: manager.id,
        roleId: await systemRole('branch-manager'),
        branchId,
      });
      expect(
        await can(manager.id, businessId, 'terminal:activate', branchId),
      ).toBe(true);
      expect(
        await can(manager.id, businessId, 'terminal:activate', other),
      ).toBe(false);

      const local = await createRole(businessId, 'Local supervisor');
      await owner().query(
        `UPDATE roles SET branch_id = $2 WHERE id = $1;
         `.trim(),
        [local, branchId],
      );
      await owner().query(
        "INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, 'terminal:activate')",
        [local],
      );
      const supervisor = await createUser();
      await createMembership({
        businessId,
        userId: supervisor.id,
        roleId: local,
      });
      expect(
        await can(supervisor.id, businessId, 'terminal:activate', branchId),
      ).toBe(true);
      expect(
        await can(supervisor.id, businessId, 'terminal:activate', other),
      ).toBe(false);
    });

    it('ignores a custom role of another business', async () => {
      const a = await createBusinessWithOwner();
      const b = await createBusinessWithOwner();
      const foreign = await createRole(b.businessId, 'Foreign');
      await owner().query(
        "INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, 'business:update')",
        [foreign],
      );
      const user = await createUser();
      await owner().query(
        `INSERT INTO business_memberships (business_id, user_id, role_id) VALUES ($1, $2, $3)`,
        [a.businessId, user.id, foreign],
      );
      expect(await can(user.id, a.businessId, 'business:update')).toBe(false);
    });
  });

  describe('through the API', () => {
    let app: INestApplication;
    let http: ReturnType<typeof request>;

    beforeAll(async () => {
      app = await createTestApp();
      http = request(app.getHttpServer());
    });

    afterAll(async () => {
      await app.close();
      await closePools();
    });

    async function signIn(
      email: string,
      terminalId: string,
    ): Promise<{ Authorization: string }> {
      const response = await http
        .post(`${API}/authentication/login`)
        .set('x-client-type', 'desktop')
        .set('x-terminal-id', terminalId)
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      return { Authorization: `Bearer ${response.body.accessToken}` };
    }

    async function member(roleKey: string, branchId: string | null = null) {
      const seeded = await createBusinessWithOwner();
      const user = await createUser();
      await createMembership({
        businessId: seeded.businessId,
        userId: user.id,
        roleId: await systemRole(roleKey),
        branchId,
      });
      return { ...seeded, user };
    }

    it('lets a cashier read the business but not edit it', async () => {
      const seeded = await member('cashier');
      const auth = await signIn(seeded.user.email, seeded.terminalId);
      await http
        .get(`${API}/businesses/${seeded.businessId}`)
        .set(auth)
        .expect(200)
        .expect(({ body }) => expect(body.id).toBe(seeded.businessId));
      await http
        .patch(`${API}/businesses/${seeded.businessId}`)
        .set(auth)
        .set('x-client-type', 'desktop')
        .set('idempotency-key', 'cashier-edit-0001')
        .field('reason', 'Trying to rename')
        .field('displayName', 'Mine now')
        .expect(403);
    });

    it('returns the effective permissions on sign-in', async () => {
      const seeded = await member('viewer');
      const response = await http
        .post(`${API}/authentication/login`)
        .set('x-client-type', 'desktop')
        .set('x-terminal-id', seeded.terminalId)
        .send({ email: seeded.user.email, password: TEST_PASSWORD })
        .expect(200);
      expect(response.body.effectivePermissions).toEqual([
        'branch:read',
        'business:read',
        'member:read',
        'role:read',
        'terminal:read',
      ]);
    });

    it('denies another business with the same 403 as a missing permission', async () => {
      const seeded = await member('admin');
      const other = await createBusinessWithOwner();
      const auth = await signIn(seeded.user.email, seeded.terminalId);
      const foreign = await http
        .get(`${API}/businesses/${other.businessId}`)
        .set(auth)
        .expect(403);
      await override(
        seeded.businessId,
        seeded.user.id,
        'business:read',
        'deny',
      );
      const denied = await http
        .get(`${API}/businesses/${seeded.businessId}`)
        .set(auth)
        .expect(403);
      expect(foreign.body.message).toBe(denied.body.message);
    });

    it('scopes terminal activation to the branch manager’s branch', async () => {
      const seeded = await createBusinessWithOwner();
      const other = await createBranch(seeded.businessId);
      const manager = await createUser();
      await createMembership({
        businessId: seeded.businessId,
        userId: manager.id,
        roleId: await systemRole('branch-manager'),
        branchId: seeded.branchId,
      });
      const auth = await signIn(manager.email, seeded.terminalId);
      const pending = await createTerminal(
        seeded.businessId,
        seeded.branchId,
        'inactive',
      );
      const { rows } = await owner().query<{ terminal_code: string }>(
        'SELECT terminal_code FROM terminals WHERE id = $1',
        [pending],
      );

      await http
        .post(
          `${API}/businesses/${seeded.businessId}/branches/${other}/terminals/activate`,
        )
        .set(auth)
        .send({ terminalCode: rows[0].terminal_code })
        .expect(403);
      await http
        .post(
          `${API}/businesses/${seeded.businessId}/branches/${seeded.branchId}/terminals/activate`,
        )
        .set(auth)
        .send({ terminalCode: rows[0].terminal_code })
        .expect(200)
        .expect(({ body }) => expect(body.status).toBe('active'));
    });

    it('maps platform roles to platform permissions', async () => {
      const support = await createPlatformUser({ role: 'support' });
      const signIn = await http
        .post(`${API}/platform/user/login`)
        .set('x-client-type', 'web')
        .send({ email: support.email, password: TEST_PASSWORD })
        .expect(200);
      const auth = { Authorization: `Bearer ${signIn.body.accessToken}` };
      await http
        .get(`${API}/platform`)
        .set(auth)
        .set('x-client-type', 'web')
        .expect(200);
      await http
        .post(`${API}/platform/users/invite`)
        .set(auth)
        .set('x-client-type', 'web')
        .set('x-idempotency-key', 'support-invite-0001')
        .send({ email: 'new-staff@fortis.test', name: 'New Staff' })
        .expect(403);
    });
  });
});
