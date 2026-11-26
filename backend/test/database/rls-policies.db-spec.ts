import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { TEST_DB } from '../setup/test-database.env';
import {
  createBranch,
  createBusinessWithOwner,
  createMembership,
  createPlatformUser,
  createRole,
  createTerminal,
  createUser,
} from './helpers/factories';
import { asApp, closePools, owner, truncateAll } from './helpers/test-db';

type Ctx = Record<string, string>;

async function ids(ctx: Ctx, sql: string, params: unknown[] = []) {
  return asApp(ctx, async (client) => {
    const { rows } = await client.query<{ id: string }>(sql, params);
    return rows.map((row) => row.id).sort();
  });
}

async function rowCount(ctx: Ctx, sql: string, params: unknown[] = []) {
  return asApp(ctx, async (client) => {
    const result = await client.query(sql, params);
    return result.rowCount ?? 0;
  });
}

/**
 * Two businesses (A, B). A has two branches, an owner, a branch-scoped cashier
 * and a business-wide manager. B has its own owner.
 */
async function world() {
  const a = await createBusinessWithOwner();
  const aBranch2 = await createBranch(a.businessId);
  const aTerminal2 = await createTerminal(a.businessId, aBranch2);
  const aRole = await createRole(a.businessId);
  const cashier = await createUser();
  await createMembership({
    businessId: a.businessId,
    userId: cashier.id,
    roleId: aRole,
    branchId: a.branchId,
  });
  const manager = await createUser();
  await createMembership({
    businessId: a.businessId,
    userId: manager.id,
    roleId: aRole,
  });
  const b = await createBusinessWithOwner();
  return { a, aBranch2, aTerminal2, aRole, cashier, manager, b };
}

const as = (userId: string): Ctx => ({ 'app.user_id': userId });

describe('RLS policies (as fortis_app)', () => {
  beforeEach(truncateAll);
  afterAll(closePools);

  describe('tenant isolation', () => {
    it('shows a member only their own business', async () => {
      const { a, b } = await world();
      expect(await ids(as(a.owner.id), 'SELECT id FROM business')).toEqual([
        a.businessId,
      ]);
      expect(
        await ids(as(a.owner.id), 'SELECT id FROM business WHERE id = $1', [
          b.businessId,
        ]),
      ).toEqual([]);
    });

    it('hides other businesses’ memberships, roles, terminals and users', async () => {
      const { a, b } = await world();
      const ctx = as(a.owner.id);
      expect(
        await ids(
          ctx,
          'SELECT id FROM business_memberships WHERE business_id = $1',
          [b.businessId],
        ),
      ).toEqual([]);
      expect(
        await ids(ctx, 'SELECT id FROM terminals WHERE business_id = $1', [
          b.businessId,
        ]),
      ).toEqual([]);
      expect(
        await ids(ctx, 'SELECT id FROM users WHERE id = $1', [b.owner.id]),
      ).toEqual([]);
    });

    it('shows coworkers only to members with member:read', async () => {
      const { a, cashier } = await world();
      // The custom role grants nothing: the cashier sees only themselves.
      expect(
        await ids(as(cashier.id), 'SELECT id FROM users WHERE id = $1', [
          a.owner.id,
        ]),
      ).toEqual([]);
      expect(
        await ids(
          as(cashier.id),
          'SELECT user_id AS id FROM business_memberships',
        ),
      ).toEqual([cashier.id]);
      // The owner holds member:read.
      expect(
        await ids(as(a.owner.id), 'SELECT id FROM users WHERE id = $1', [
          cashier.id,
        ]),
      ).toEqual([cashier.id]);
    });

    it('returns nothing without a request context', async () => {
      await world();
      for (const table of [
        'business',
        'branches',
        'terminals',
        'business_memberships',
        'users',
        'access_logs',
      ]) {
        const rows = await ids({}, `SELECT id FROM ${table}`);
        expect({ table, rows }).toEqual({ table, rows: [] });
      }
      // System roles are shared reference data; business roles stay hidden.
      expect(
        await ids({}, 'SELECT id FROM roles WHERE business_id IS NOT NULL'),
      ).toEqual([]);
    });
  });

  describe('branch scope', () => {
    it('limits a branch member to their branch’s branches and terminals', async () => {
      const { a, aBranch2, cashier } = await world();
      expect(await ids(as(cashier.id), 'SELECT id FROM branches')).toEqual([
        a.branchId,
      ]);
      expect(await ids(as(cashier.id), 'SELECT id FROM terminals')).toEqual([
        a.terminalId,
      ]);
      expect(
        await ids(as(cashier.id), 'SELECT id FROM branches WHERE id = $1', [
          aBranch2,
        ]),
      ).toEqual([]);
    });

    it('lets business-wide members and the owner see every branch', async () => {
      const { a, aBranch2, manager } = await world();
      const all = [a.branchId, aBranch2].sort();
      expect(await ids(as(manager.id), 'SELECT id FROM branches')).toEqual(all);
      expect(await ids(as(a.owner.id), 'SELECT id FROM branches')).toEqual(all);
    });
  });

  describe('platform access', () => {
    it('ignores the old is_platform_user flag', async () => {
      await world();
      expect(
        await ids(
          { 'app.is_platform_user': 'true', 'app.is_owner': 'true' },
          'SELECT id FROM business',
        ),
      ).toEqual([]);
    });

    it('requires an existing, active platform user', async () => {
      const { a, b } = await world();
      const staff = await createPlatformUser();
      const disabled = await createPlatformUser({ status: 'disabled' });

      expect(
        await ids(
          { 'app.platform_user_id': staff.id },
          'SELECT id FROM business',
        ),
      ).toEqual([a.businessId, b.businessId].sort());
      for (const platformUserId of [disabled.id, randomUUID()]) {
        expect(
          await ids(
            { 'app.platform_user_id': platformUserId },
            'SELECT id FROM business',
          ),
        ).toEqual([]);
      }
    });
  });

  describe('writes', () => {
    it('lets only the owner update the business profile', async () => {
      const { a, manager } = await world();
      const update = 'UPDATE business SET display_name = $2 WHERE id = $1';
      expect(await rowCount(as(manager.id), update, [a.businessId, 'x'])).toBe(
        0,
      );
      expect(await rowCount(as(a.owner.id), update, [a.businessId, 'x'])).toBe(
        1,
      );
    });

    it('lets nobody write roles directly (only app.save_role)', async () => {
      const { a, cashier } = await world();
      for (const userId of [cashier.id, a.owner.id]) {
        await expect(
          rowCount(
            { ...as(userId), 'app.branch_id': a.branchId },
            'INSERT INTO roles (business_id, name, key) VALUES ($1, $2, $3)',
            [a.businessId, 'Sneaky', 'sneaky'],
          ),
        ).rejects.toMatchObject({ code: '42501' });
      }
      const { rows } = await asApp(as(a.owner.id), (client) =>
        client.query<{ outcome: string }>(
          `SELECT outcome FROM app.save_role($1, NULL, 'supervisor', 'Supervisor',
             NULL, NULL, true, ARRAY['business:read'])`,
          [a.businessId],
        ),
      );
      expect(rows[0].outcome).toBe('ok');
    });

    it('changes memberships only through app.end_membership', async () => {
      const { a, cashier, manager } = await world();
      const deactivate =
        'UPDATE business_memberships SET is_active = false WHERE user_id = $1';
      expect(await rowCount(as(cashier.id), deactivate, [manager.id])).toBe(0);
      expect(await rowCount(as(a.owner.id), deactivate, [manager.id])).toBe(0);
      const end = (userId: string) =>
        asApp(as(userId), (client) =>
          client.query<{ outcome: string }>(
            'SELECT app.end_membership($1, NULL, $2) AS outcome',
            [a.businessId, manager.id],
          ),
        );
      expect((await end(cashier.id)).rows[0].outcome).toBe('forbidden');
      expect((await end(a.owner.id)).rows[0].outcome).toBe('ok');
    });

    it('never updates the owner row and never promotes a member to owner', async () => {
      const { a, manager } = await world();
      const staff = await createPlatformUser();
      const deactivateOwner =
        'UPDATE business_memberships SET is_active = false WHERE user_id = $1';
      expect(
        await rowCount(as(a.owner.id), deactivateOwner, [a.owner.id]),
      ).toBe(0);
      expect(
        await rowCount({ 'app.platform_user_id': staff.id }, deactivateOwner, [
          a.owner.id,
        ]),
      ).toBe(0);
      expect(
        await rowCount(
          as(a.owner.id),
          'UPDATE business_memberships SET is_owner = true WHERE user_id = $1',
          [manager.id],
        ),
      ).toBe(0);
      await expect(
        rowCount(
          { 'app.platform_user_id': staff.id },
          'UPDATE business_memberships SET is_owner = true WHERE user_id = $1',
          [manager.id],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('does not let anyone create users without a redemption (old invitation hole)', async () => {
      const { a } = await world();
      await owner().query(
        `INSERT INTO invitations (business_id, email_normalized, role_id, token_hash, expires_at, invited_by_user_id)
         VALUES ($1, 'victim@fortis.test', (SELECT id FROM roles WHERE business_id = $1 LIMIT 1),
                 repeat('a', 64), now() + interval '1 day', $2)`,
        [a.businessId, a.owner.id],
      );
      await expect(
        rowCount(
          {},
          `INSERT INTO users (email_normalized, password_hash, name)
           VALUES ('victim@fortis.test', 'x', 'Attacker')`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('keeps the legacy helper functions out of the runtime role’s reach', async () => {
      await expect(
        asApp({}, (client) => client.query('SELECT public.app_is_platform()')),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('tightened after review', () => {
    it('shows the business row (documents, PAN) only to the owner', async () => {
      const { a, manager, cashier } = await world();
      for (const userId of [manager.id, cashier.id]) {
        expect(await ids(as(userId), 'SELECT id FROM business')).toEqual([]);
      }
      expect(await ids(as(a.owner.id), 'SELECT id FROM business')).toEqual([
        a.businessId,
      ]);
    });

    it('does not let an owner attach an outsider to their business', async () => {
      const { a, aRole } = await world();
      const outsider = await createUser();
      await expect(
        rowCount(
          as(a.owner.id),
          'INSERT INTO business_memberships (business_id, user_id, role_id) VALUES ($1, $2, $3)',
          [a.businessId, outsider.id, aRole],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('hides users whose membership in my business has ended', async () => {
      const { a, aRole } = await world();
      const former = await createUser();
      await createMembership({
        businessId: a.businessId,
        userId: former.id,
        roleId: aRole,
        isActive: false,
      });
      expect(
        await ids(as(a.owner.id), 'SELECT id FROM users WHERE id = $1', [
          former.id,
        ]),
      ).toEqual([]);
    });

    it('never lets the runtime role read password hashes', async () => {
      const { a } = await world();
      const staff = await createPlatformUser({ isBootstrap: true });
      await expect(
        asApp(as(a.owner.id), (client) =>
          client.query('SELECT password_hash FROM users WHERE id = $1', [
            a.owner.id,
          ]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        asApp({ 'app.platform_user_id': staff.id }, (client) =>
          client.query('SELECT password_hash FROM platform_users'),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('lets only bootstrap staff list other platform users', async () => {
      const staff = await createPlatformUser();
      const other = await createPlatformUser();
      const boss = await createPlatformUser({ isBootstrap: true });
      expect(
        await ids(
          { 'app.platform_user_id': staff.id },
          'SELECT id FROM platform_users',
        ),
      ).toEqual([staff.id]);
      expect(
        await ids(
          { 'app.platform_user_id': boss.id },
          'SELECT id FROM platform_users',
        ),
      ).toEqual([staff.id, other.id, boss.id].sort());
    });
  });

  describe('pooled connections', () => {
    it('does not carry one transaction’s context into the next on the same connection', async () => {
      const { a } = await world();
      const pool = new Pool({ connectionString: TEST_DB.appUrl, max: 1 });
      try {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.user_id', $1, true)", [
            a.owner.id,
          ]);
          const inside = await client.query('SELECT id FROM business');
          expect(inside.rowCount).toBe(1);
          await client.query('COMMIT');
          const after = await client.query('SELECT id FROM business');
          expect(after.rowCount).toBe(0);
        } finally {
          client.release();
        }
        const reused = await pool.query('SELECT id FROM business');
        expect(reused.rowCount).toBe(0);
      } finally {
        await pool.end();
      }
    });
  });
});
