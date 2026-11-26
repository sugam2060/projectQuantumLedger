import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { EMAIL_QUEUE } from '../../src/jobs/email/types';
import type { MailJob } from '../../src/jobs/email/types';
import { createTestApp } from '../common/helpers/create-test-app';
import {
  createBranch,
  createBusinessWithOwner,
  createMembership,
  createPlatformUser,
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
const NEW_PASSWORD = 'Brand-New-Password-42';

type Auth = { Authorization: string };
type Seeded = Awaited<ReturnType<typeof createBusinessWithOwner>>;

async function systemRole(key: string): Promise<string> {
  const { rows } = await owner().query<{ id: string }>(
    'SELECT id FROM roles WHERE business_id IS NULL AND key = $1',
    [key],
  );
  return rows[0].id;
}

describe('roles, members and invitations (real database)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const queued: MailJob[] = [];

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder.overrideProvider(getQueueToken(EMAIL_QUEUE)).useValue({
        add: async (_name: string, job: MailJob) => {
          queued.push(job);
        },
      }),
    );
    http = request(app.getHttpServer());
  });

  beforeEach(async () => {
    await truncateAll();
    queued.length = 0;
  });

  afterAll(async () => {
    await app.close();
    await closePools();
  });

  async function signIn(
    email: string,
    terminalId: string,
    password = TEST_PASSWORD,
  ): Promise<Auth & { refreshToken: string }> {
    const response = await http
      .post(`${API}/authentication/login`)
      .set('x-client-type', 'desktop')
      .set('x-terminal-id', terminalId)
      .send({ email, password })
      .expect(200);
    return {
      Authorization: `Bearer ${response.body.accessToken}`,
      refreshToken: response.body.refreshToken,
    };
  }

  /** A member with a system role (optionally limited to a branch), signed in. */
  async function member(
    seeded: Seeded,
    roleKey: string,
    branchId: string | null = null,
  ) {
    const user = await createUser();
    await createMembership({
      businessId: seeded.businessId,
      userId: user.id,
      roleId: await systemRole(roleKey),
      branchId,
    });
    const terminal = branchId
      ? await createTerminal(seeded.businessId, branchId)
      : seeded.terminalId;
    return { ...user, auth: await signIn(user.email, terminal), terminal };
  }

  const ownerAuth = (seeded: Seeded) =>
    signIn(seeded.owner.email, seeded.terminalId);

  function tokenFrom(job: MailJob | undefined): string {
    expect(job).toBeDefined();
    return (
      new URL(String(job!.context.invitationUrl)).searchParams.get('token') ??
      ''
    );
  }

  describe('roles', () => {
    it('lists the catalogue and creates, edits and deletes a custom role', async () => {
      const seeded = await createBusinessWithOwner();
      const auth = await ownerAuth(seeded);

      const catalogue = await http
        .get(`${API}/permissions`)
        .set(auth)
        .expect(200);
      expect(catalogue.body).toContainEqual({
        key: 'business:read',
        description: expect.any(String),
      });

      const created = await http
        .post(`${API}/businesses/${seeded.businessId}/roles`)
        .set(auth)
        .send({
          name: 'Shift Lead',
          permissions: ['business:read', 'terminal:activate'],
        })
        .expect(201);
      expect(created.body).toMatchObject({
        key: 'shift-lead',
        isSystem: false,
        version: 1,
        permissions: ['business:read', 'terminal:activate'],
      });

      await http
        .post(`${API}/businesses/${seeded.businessId}/roles`)
        .set(auth)
        .send({ name: 'shift lead', permissions: [] })
        .expect(409);

      const edited = await http
        .patch(
          `${API}/businesses/${seeded.businessId}/roles/${created.body.id}`,
        )
        .set(auth)
        .send({ permissions: ['business:read'] })
        .expect(200);
      expect(edited.body).toMatchObject({
        permissions: ['business:read'],
        version: 2,
      });

      const roles = await http
        .get(`${API}/businesses/${seeded.businessId}/roles`)
        .set(auth)
        .expect(200);
      expect(roles.body.map((role: { key: string }) => role.key)).toEqual(
        expect.arrayContaining(['admin', 'cashier', 'shift-lead']),
      );

      await http
        .delete(
          `${API}/businesses/${seeded.businessId}/roles/${created.body.id}`,
        )
        .set(auth)
        .expect(204);
    });

    it('keeps system roles read-only and roles in use undeletable', async () => {
      const seeded = await createBusinessWithOwner();
      const auth = await ownerAuth(seeded);
      await http
        .patch(
          `${API}/businesses/${seeded.businessId}/roles/${await systemRole('cashier')}`,
        )
        .set(auth)
        .send({ permissions: ['business:update'] })
        .expect(403);

      const role = await http
        .post(`${API}/businesses/${seeded.businessId}/roles`)
        .set(auth)
        .send({ name: 'Stock', permissions: ['business:read'] })
        .expect(201);
      const user = await createUser();
      await createMembership({
        businessId: seeded.businessId,
        userId: user.id,
        roleId: role.body.id,
      });
      await http
        .delete(`${API}/businesses/${seeded.businessId}/roles/${role.body.id}`)
        .set(auth)
        .expect(409);
    });

    it('does not let anyone put a permission they lack into a role', async () => {
      const seeded = await createBusinessWithOwner();
      const admin = await member(seeded, 'admin');
      await owner().query(
        `INSERT INTO member_permission_overrides (business_id, user_id, permission_key, effect)
         VALUES ($1, $2, 'audit:read', 'deny')`,
        [seeded.businessId, admin.id],
      );
      await http
        .post(`${API}/businesses/${seeded.businessId}/roles`)
        .set(admin.auth)
        .send({ name: 'Auditor', permissions: ['audit:read'] })
        .expect(403);
      await http
        .post(`${API}/businesses/${seeded.businessId}/roles`)
        .set(admin.auth)
        .send({ name: 'Reader', permissions: ['business:read'] })
        .expect(201);
    });
  });

  describe('members', () => {
    it('lets an admin change a member’s role but never their own or the owner’s', async () => {
      const seeded = await createBusinessWithOwner();
      const admin = await member(seeded, 'admin');
      const cashier = await member(seeded, 'cashier');
      const base = `${API}/businesses/${seeded.businessId}/members`;

      const list = await http.get(base).set(admin.auth).expect(200);
      expect(list.body.map((m: { userId: string }) => m.userId)).toEqual(
        expect.arrayContaining([seeded.owner.id, admin.id, cashier.id]),
      );

      const changed = await http
        .patch(`${base}/${cashier.id}`)
        .set(admin.auth)
        .send({ roleId: await systemRole('viewer') })
        .expect(200);
      expect(changed.body.role.key).toBe('viewer');
      expect(changed.body.effectivePermissions).toContain('role:read');

      await http
        .patch(`${base}/${admin.id}`)
        .set(admin.auth)
        .send({ roleId: await systemRole('viewer') })
        .expect(403);
      await http
        .patch(`${base}/${seeded.owner.id}`)
        .set(admin.auth)
        .send({ roleId: await systemRole('viewer') })
        .expect(403);
    });

    it('keeps branch managers inside their branch and below their own power', async () => {
      const seeded = await createBusinessWithOwner();
      const other = await createBranch(seeded.businessId);
      const manager = await member(seeded, 'branch-manager', seeded.branchId);
      const local = await member(seeded, 'cashier', seeded.branchId);
      const elsewhere = await member(seeded, 'cashier', other);
      const branchBase = `${API}/businesses/${seeded.businessId}/branches/${seeded.branchId}/members`;

      // Business-wide routes are closed to branch-limited members.
      await http
        .get(`${API}/businesses/${seeded.businessId}/members`)
        .set(manager.auth)
        .expect(403);

      const list = await http.get(branchBase).set(manager.auth).expect(200);
      const ids = list.body.map((m: { userId: string }) => m.userId);
      expect(ids).toEqual(expect.arrayContaining([manager.id, local.id]));
      expect(ids).not.toContain(elsewhere.id);

      // Other branches' members look like they do not exist.
      await http
        .patch(`${branchBase}/${elsewhere.id}`)
        .set(manager.auth)
        .send({ roleId: await systemRole('viewer') })
        .expect(404);
      // Cannot hand out admin (more than a branch manager holds).
      await http
        .patch(`${branchBase}/${local.id}`)
        .set(manager.auth)
        .send({ roleId: await systemRole('admin') })
        .expect(403);
      // Cannot move someone out of the branch or make them business-wide.
      await http
        .patch(`${branchBase}/${local.id}`)
        .set(manager.auth)
        .send({ branchId: null })
        .expect(403);
      await http
        .patch(`${branchBase}/${local.id}`)
        .set(manager.auth)
        .send({ roleId: await systemRole('viewer') })
        .expect(200);
    });

    it('ends a membership and signs the member out everywhere', async () => {
      const seeded = await createBusinessWithOwner();
      const auth = await ownerAuth(seeded);
      const cashier = await member(seeded, 'cashier');
      await http
        .post(
          `${API}/businesses/${seeded.businessId}/members/${cashier.id}/end-membership`,
        )
        .set(auth)
        .expect(204);
      await http
        .post(`${API}/authentication/refresh`)
        .set('x-client-type', 'desktop')
        .set('x-terminal-id', seeded.terminalId)
        .send({ refreshToken: cashier.auth.refreshToken })
        .expect(401);
      await http
        .get(`${API}/businesses/${seeded.businessId}/members/${cashier.id}`)
        .set(auth)
        .expect(404);
    });

    it('only grants (or lifts a deny on) permissions the manager holds', async () => {
      const seeded = await createBusinessWithOwner();
      const admin = await member(seeded, 'admin');
      const cashier = await member(seeded, 'cashier');
      const overrides = `${API}/businesses/${seeded.businessId}/members/${cashier.id}/overrides`;
      await owner().query(
        `INSERT INTO member_permission_overrides (business_id, user_id, permission_key, effect)
         VALUES ($1, $2, 'audit:read', 'deny')`,
        [seeded.businessId, admin.id],
      );

      await http
        .put(`${overrides}/audit:read`)
        .set(admin.auth)
        .send({ effect: 'allow' })
        .expect(403);
      const granted = await http
        .put(`${overrides}/member:read`)
        .set(admin.auth)
        .send({ effect: 'allow' })
        .expect(200);
      expect(granted.body.effectivePermissions).toContain('member:read');

      // A deny on audit:read set by the owner cannot be lifted by the admin.
      const boss = await ownerAuth(seeded);
      await http
        .put(`${overrides}/audit:read`)
        .set(boss)
        .send({ effect: 'deny' })
        .expect(200);
      await http.delete(`${overrides}/audit:read`).set(admin.auth).expect(403);
      await http.delete(`${overrides}/audit:read`).set(boss).expect(204);
      await http.delete(`${overrides}/not:a_key`).set(boss).expect(400);
    });

    it('blocks every direct membership, role or override write', async () => {
      const seeded = await createBusinessWithOwner();
      const admin = await member(seeded, 'admin');
      const { rows } = await owner().query<{ id: string }>(
        `SELECT id FROM business_memberships WHERE user_id = $1`,
        [admin.id],
      );
      const ctx = {
        'app.user_id': seeded.owner.id,
        'app.business_id': seeded.businessId,
      };
      const updated = await asApp(ctx, (client) =>
        client.query(
          `UPDATE business_memberships SET role_id = NULL, is_owner = true WHERE id = $1`,
          [rows[0].id],
        ),
      );
      expect(updated.rowCount).toBe(0);
      for (const statement of [
        `INSERT INTO roles (business_id, key, name) VALUES ('${seeded.businessId}', 'x', 'X')`,
        `INSERT INTO member_permission_overrides (business_id, user_id, permission_key, effect)
           VALUES ('${seeded.businessId}', '${admin.id}', 'audit:read', 'allow')`,
      ]) {
        await expect(
          asApp(ctx, (client) => client.query(statement)),
        ).rejects.toMatchObject({ code: '42501' });
      }
    });
  });

  describe('invitations', () => {
    it('invites, previews and lets a new person create an account by accepting', async () => {
      const seeded = await createBusinessWithOwner();
      const auth = await ownerAuth(seeded);
      const existing = await member(seeded, 'cashier');

      const invited = await http
        .post(`${API}/businesses/${seeded.businessId}/invitations`)
        .set(auth)
        .send({
          emails: ['New.Person@Fortis.test', existing.email],
          roleId: await systemRole('cashier'),
          branchId: seeded.branchId,
        })
        .expect(200);
      expect(invited.body.results).toEqual([
        { email: 'new.person@fortis.test', status: 'invited' },
        { email: existing.email, status: 'already_member' },
      ]);
      expect(queued).toHaveLength(1);
      const token = tokenFrom(queued[0]);
      const { rows } = await owner().query<{ token_hash: string }>(
        'SELECT token_hash FROM invitations WHERE email_normalized = $1',
        ['new.person@fortis.test'],
      );
      expect(rows[0].token_hash).not.toBe(token);

      const preview = await http
        .get(`${API}/invitations/preview`)
        .query({ token })
        .expect(200);
      expect(preview.body).toMatchObject({
        email: 'new.person@fortis.test',
        roleName: 'Cashier',
        accountExists: false,
      });

      await http
        .post(`${API}/invitations/accept`)
        .send({ token, password: NEW_PASSWORD })
        .expect(400);
      const accepted = await http
        .post(`${API}/invitations/accept`)
        .send({ token, password: NEW_PASSWORD, name: 'New Person' })
        .expect(200);
      expect(accepted.body).toMatchObject({
        businessId: seeded.businessId,
        accountCreated: true,
      });
      await http
        .post(`${API}/invitations/accept`)
        .send({ token, password: NEW_PASSWORD, name: 'Again' })
        .expect(400);

      const signedIn = await signIn(
        'new.person@fortis.test',
        seeded.terminalId,
        NEW_PASSWORD,
      );
      await http
        .get(`${API}/businesses/${seeded.businessId}`)
        .set(signedIn)
        .expect(200);
    });

    it('asks existing members of another business to confirm resigning', async () => {
      const a = await createBusinessWithOwner();
      const b = await createBusinessWithOwner();
      const worker = await member(a, 'cashier');
      const auth = await ownerAuth(b);
      await http
        .post(`${API}/businesses/${b.businessId}/invitations`)
        .set(auth)
        .send({ emails: [worker.email], roleId: await systemRole('viewer') })
        .expect(200);
      const token = tokenFrom(queued[0]);

      await http
        .post(`${API}/invitations/accept`)
        .send({ token, password: 'Wrong-password-1' })
        .expect(400);
      await http
        .post(`${API}/invitations/accept`)
        .send({ token, password: TEST_PASSWORD })
        .expect(409);
      await http
        .post(`${API}/invitations/accept`)
        .send({ token, password: TEST_PASSWORD, confirmResignation: true })
        .expect(200)
        .expect(({ body }) => expect(body.accountCreated).toBe(false));

      // The old business's sessions are gone and its membership ended.
      await http
        .post(`${API}/authentication/refresh`)
        .set('x-client-type', 'desktop')
        .set('x-terminal-id', a.terminalId)
        .send({ refreshToken: worker.auth.refreshToken })
        .expect(401);
      const { rows } = await owner().query<{ business_id: string }>(
        'SELECT business_id FROM business_memberships WHERE user_id = $1 AND is_active',
        [worker.id],
      );
      expect(rows).toEqual([{ business_id: b.businessId }]);
    });

    it('never lets an owner resign by accepting', async () => {
      const a = await createBusinessWithOwner();
      const b = await createBusinessWithOwner();
      const bossAuth = await ownerAuth(b);
      await http
        .post(`${API}/businesses/${b.businessId}/invitations`)
        .set(bossAuth)
        .send({ emails: [a.owner.email], roleId: await systemRole('viewer') })
        .expect(200);
      await http
        .post(`${API}/invitations/accept`)
        .send({
          token: tokenFrom(queued[0]),
          password: TEST_PASSWORD,
          confirmResignation: true,
        })
        .expect(409);
    });

    it('resends with a new token, revokes, and limits branch managers', async () => {
      const seeded = await createBusinessWithOwner();
      const auth = await ownerAuth(seeded);
      await http
        .post(`${API}/businesses/${seeded.businessId}/invitations`)
        .set(auth)
        .send({ emails: ['x@fortis.test'], roleId: await systemRole('viewer') })
        .expect(200);
      const first = tokenFrom(queued[0]);
      const list = await http
        .get(`${API}/businesses/${seeded.businessId}/invitations`)
        .set(auth)
        .expect(200);
      const id = list.body[0].id;
      expect(list.body[0]).toMatchObject({ status: 'open' });

      await http
        .post(`${API}/businesses/${seeded.businessId}/invitations/${id}/resend`)
        .set(auth)
        .expect(200);
      const second = tokenFrom(queued[1]);
      expect(second).not.toBe(first);
      await http
        .get(`${API}/invitations/preview`)
        .query({ token: first })
        .expect(404);
      await http
        .delete(`${API}/businesses/${seeded.businessId}/invitations/${id}`)
        .set(auth)
        .expect(204);
      await http
        .get(`${API}/invitations/preview`)
        .query({ token: second })
        .expect(404);

      const manager = await member(seeded, 'branch-manager', seeded.branchId);
      const branchInvites = `${API}/businesses/${seeded.businessId}/branches/${seeded.branchId}/invitations`;
      await http
        .post(`${API}/businesses/${seeded.businessId}/invitations`)
        .set(manager.auth)
        .send({
          emails: ['y@fortis.test'],
          roleId: await systemRole('cashier'),
        })
        .expect(403);
      const results = await http
        .post(branchInvites)
        .set(manager.auth)
        .send({
          emails: ['y@fortis.test', 'z@fortis.test'],
          roleId: await systemRole('admin'),
        })
        .expect(200);
      expect(
        results.body.results.map((r: { status: string }) => r.status),
      ).toEqual(['forbidden', 'forbidden']);
      const ok = await http
        .post(branchInvites)
        .set(manager.auth)
        .send({
          emails: ['y@fortis.test'],
          roleId: await systemRole('cashier'),
        })
        .expect(200);
      expect(ok.body.results[0].status).toBe('invited');
      const { rows } = await owner().query<{ branch_id: string }>(
        `SELECT branch_id FROM invitations WHERE email_normalized = 'y@fortis.test'`,
      );
      expect(rows[0].branch_id).toBe(seeded.branchId);
    });
  });

  describe('platform staff invitations', () => {
    it('emails a real token, creates the account once, with the invited role', async () => {
      const boss = await createPlatformUser({ isBootstrap: true });
      const signedIn = await http
        .post(`${API}/platform/user/login`)
        .set('x-client-type', 'web')
        .send({ email: boss.email, password: TEST_PASSWORD })
        .expect(200);
      await http
        .post(`${API}/platform/users/invite`)
        .set('Authorization', `Bearer ${signedIn.body.accessToken}`)
        .set('x-client-type', 'web')
        .set('x-idempotency-key', 'staff-invite-0001')
        .send({
          email: 'support@fortis.test',
          name: 'Support',
          role: 'support',
        })
        .expect(200);
      const token =
        new URL(String(queued[0].context.invitationUrl)).searchParams.get(
          'token',
        ) ?? '';
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const accepted = await http
        .post(`${API}/platform/users/invitations/accept`)
        .send({ token, password: NEW_PASSWORD });
      expect(accepted.body).toEqual({ platformUserId: expect.any(String) });
      await http
        .post(`${API}/platform/users/invitations/accept`)
        .send({ token, password: NEW_PASSWORD })
        .expect(400);
      const { rows } = await owner().query<{ role: string; name: string }>(
        `SELECT role, name FROM platform_users WHERE email_normalized = 'support@fortis.test'`,
      );
      expect(rows).toEqual([{ role: 'support', name: 'Support' }]);
      await http
        .post(`${API}/platform/user/login`)
        .set('x-client-type', 'web')
        .send({ email: 'support@fortis.test', password: NEW_PASSWORD })
        .expect(200);
    });

    it('rejects the stored hash used as a token', async () => {
      const boss = await createPlatformUser({ isBootstrap: true });
      await owner().query(
        `INSERT INTO invitations (email_normalized, invitee_name, invitation_type, token_hash,
           expires_at, invited_by_platform_user_id)
         VALUES ('h@fortis.test', 'H', 'platform_user', $1, now() + interval '1 day', $2)`,
        ['a'.repeat(43), boss.id],
      );
      await http
        .post(`${API}/platform/users/invitations/accept`)
        .send({ token: 'a'.repeat(43), password: NEW_PASSWORD })
        .expect(400);
    });
  });
});
