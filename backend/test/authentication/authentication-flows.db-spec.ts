import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { EMAIL_QUEUE } from '../../src/jobs/email/types';
import { createTestApp } from '../common/helpers/create-test-app';
import {
  createBusinessWithOwner,
  createPlatformUser,
  createTerminal,
  createUser,
  TEST_PASSWORD,
} from '../database/helpers/factories';
import { closePools, owner, truncateAll } from '../database/helpers/test-db';

const API = '/api/v1';

/** Value of the refresh_token cookie in a Set-Cookie header list, if any. */
function refreshCookie(response: request.Response): string | undefined {
  const raw = response.headers['set-cookie'] as unknown;
  const cookies = Array.isArray(raw) ? (raw as string[]) : [];
  const cookie = cookies.find((value) => value.startsWith('refresh_token='));
  return cookie?.split(';')[0].slice('refresh_token='.length) || undefined;
}

function setCookieHeader(response: request.Response): string {
  const raw = response.headers['set-cookie'] as unknown;
  return (Array.isArray(raw) ? (raw as string[]) : []).join('\n');
}

describe('authentication flows (real database)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder
        .overrideProvider(getQueueToken(EMAIL_QUEUE))
        .useValue({ add: async () => undefined }),
    );
    http = request(app.getHttpServer());
  });

  beforeEach(truncateAll);

  afterAll(async () => {
    await app.close();
    await closePools();
  });

  function desktopLogin(seeded: {
    terminalId: string;
    owner: { email: string };
  }) {
    return http
      .post(`${API}/authentication/login`)
      .set('x-client-type', 'desktop')
      .set('x-terminal-id', seeded.terminalId)
      .send({ email: seeded.owner.email, password: TEST_PASSWORD });
  }

  describe('business users', () => {
    it('signs in on desktop with both tokens in the body', async () => {
      const seeded = await createBusinessWithOwner();
      const response = await desktopLogin(seeded);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        tokenType: 'Bearer',
        expiresIn: '15m',
        user: { id: seeded.owner.id, email: seeded.owner.email },
        memberships: [
          expect.objectContaining({
            businessId: seeded.businessId,
            isOwner: true,
          }),
        ],
      });
      expect(response.body).not.toHaveProperty('refreshMaxAgeMs');
      expect(setCookieHeader(response)).not.toContain('refresh_token=');

      const { rows } = await owner().query<{ refresh_token_hash: string }>(
        'SELECT refresh_token_hash FROM sessions WHERE user_id = $1',
        [seeded.owner.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].refresh_token_hash).not.toBe(response.body.refreshToken);
    });

    it('signs a browser in with the access token in the body and the refresh token in a scoped cookie', async () => {
      const seeded = await createBusinessWithOwner();
      const response = await http
        .post(`${API}/authentication/login`)
        .set('x-client-type', 'web')
        .send({
          email: seeded.owner.email,
          password: TEST_PASSWORD,
          remember: true,
        });

      expect(response.status).toBe(200);
      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body).not.toHaveProperty('refreshToken');
      const cookie = setCookieHeader(response);
      expect(cookie).toMatch(/refresh_token=[A-Za-z0-9_-]{43}/);
      expect(cookie).toContain('Path=/api/v1/authentication');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Max-Age=');
      expect(cookie).not.toContain('access_token');
    });

    it('answers one generic 401 for a wrong password and for an unknown email', async () => {
      const seeded = await createBusinessWithOwner();
      const wrong = await http
        .post(`${API}/authentication/login`)
        .set('x-client-type', 'web')
        .send({ email: seeded.owner.email, password: 'Wrong-password-1' });
      const unknown = await http
        .post(`${API}/authentication/login`)
        .set('x-client-type', 'web')
        .send({ email: 'nobody@fortis.test', password: 'Wrong-password-1' });

      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.message).toBe(unknown.body.message);
    });

    it('requires an active terminal of the member’s business', async () => {
      const seeded = await createBusinessWithOwner();
      const other = await createBusinessWithOwner();
      const inactive = await createTerminal(
        seeded.businessId,
        seeded.branchId,
        'inactive',
      );

      for (const terminalId of [inactive, other.terminalId]) {
        const response = await http
          .post(`${API}/authentication/login`)
          .set('x-client-type', 'desktop')
          .set('x-terminal-id', terminalId)
          .send({ email: seeded.owner.email, password: TEST_PASSWORD });
        expect(response.status).toBe(401);
      }
    });

    it('rehashes a legacy bcrypt password to argon2id on sign-in', async () => {
      const seeded = await createBusinessWithOwner();
      await desktopLogin(seeded).expect(200);
      const { rows } = await owner().query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [seeded.owner.id],
      );
      expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
      await desktopLogin(seeded).expect(200);
    });

    it('rotates refresh tokens, detects reuse and then rejects every session', async () => {
      const seeded = await createBusinessWithOwner();
      const login = await desktopLogin(seeded).expect(200);
      const first = login.body.refreshToken as string;

      const refreshed = await http
        .post(`${API}/authentication/refresh`)
        .set('x-client-type', 'desktop')
        .set('x-terminal-id', seeded.terminalId)
        .send({ refreshToken: first })
        .expect(200);
      const second = refreshed.body.refreshToken as string;
      expect(second).not.toBe(first);

      // Replaying the rotated token looks like theft: everything is revoked.
      await http
        .post(`${API}/authentication/refresh`)
        .set('x-client-type', 'desktop')
        .set('x-terminal-id', seeded.terminalId)
        .send({ refreshToken: first })
        .expect(401);
      await http
        .post(`${API}/authentication/refresh`)
        .set('x-client-type', 'desktop')
        .set('x-terminal-id', seeded.terminalId)
        .send({ refreshToken: second })
        .expect(401);
    });

    it('refreshes a browser from its cookie and clears the cookie on failure', async () => {
      const seeded = await createBusinessWithOwner();
      const login = await http
        .post(`${API}/authentication/login`)
        .set('x-client-type', 'web')
        .send({ email: seeded.owner.email, password: TEST_PASSWORD })
        .expect(200);
      const cookie = refreshCookie(login);
      expect(cookie).toBeDefined();
      expect(setCookieHeader(login)).not.toContain('Max-Age=');

      const refreshed = await http
        .post(`${API}/authentication/refresh`)
        .set('x-client-type', 'web')
        .set('Cookie', `refresh_token=${cookie}`)
        .send({})
        .expect(200);
      expect(refreshed.body).not.toHaveProperty('refreshToken');
      expect(refreshCookie(refreshed)).toBeDefined();

      const failed = await http
        .post(`${API}/authentication/refresh`)
        .set('x-client-type', 'web')
        .set('Cookie', 'refresh_token=not-a-real-token')
        .send({})
        .expect(401);
      expect(setCookieHeader(failed)).toMatch(/refresh_token=;/);
    });

    it('logs out with 204 so the token no longer refreshes, even without an access token', async () => {
      const seeded = await createBusinessWithOwner();
      const login = await desktopLogin(seeded).expect(200);

      await http
        .post(`${API}/authentication/logout`)
        .set('x-client-type', 'desktop')
        .send({ refreshToken: login.body.refreshToken })
        .expect(204);
      await http
        .post(`${API}/authentication/logout`)
        .set('x-client-type', 'desktop')
        .send({ refreshToken: 'unknown' })
        .expect(204);
      await http
        .post(`${API}/authentication/refresh`)
        .set('x-client-type', 'desktop')
        .set('x-terminal-id', seeded.terminalId)
        .send({ refreshToken: login.body.refreshToken })
        .expect(401);
    });

    it('logout-all revokes every session of the user', async () => {
      const seeded = await createBusinessWithOwner();
      const a = await desktopLogin(seeded).expect(200);
      const b = await desktopLogin(seeded).expect(200);

      const result = await http
        .post(`${API}/authentication/logout-all`)
        .set('Authorization', `Bearer ${a.body.accessToken}`)
        .expect(200);
      expect(result.body).toEqual({ revoked: 2 });

      for (const token of [a.body.refreshToken, b.body.refreshToken]) {
        await http
          .post(`${API}/authentication/refresh`)
          .set('x-client-type', 'desktop')
          .set('x-terminal-id', seeded.terminalId)
          .send({ refreshToken: token })
          .expect(401);
      }
    });

    it('/me rejects a still-valid token once the account is disabled', async () => {
      const seeded = await createBusinessWithOwner();
      const login = await desktopLogin(seeded).expect(200);
      const me = () =>
        http
          .get(`${API}/authentication/me`)
          .set('Authorization', `Bearer ${login.body.accessToken}`)
          .set('x-client-type', 'desktop')
          .set('x-terminal-id', seeded.terminalId);

      await me().expect(200);
      await owner().query(
        "UPDATE users SET status = 'disabled' WHERE id = $1",
        [seeded.owner.id],
      );
      await me().expect(401);
    });

    it('refuses a user with no active membership', async () => {
      const loner = await createUser();
      await http
        .post(`${API}/authentication/login`)
        .set('x-client-type', 'web')
        .send({ email: loner.email, password: TEST_PASSWORD })
        .expect(401);
    });
  });

  describe('platform users', () => {
    it('signs in, refreshes with rotation and logs out', async () => {
      const staff = await createPlatformUser();
      const login = await http
        .post(`${API}/platform/user/login`)
        .set('x-client-type', 'desktop')
        .send({ email: staff.email, password: TEST_PASSWORD })
        .expect(200);
      expect(login.body).toMatchObject({
        isPlatform: true,
        user: { id: staff.id },
        refreshToken: expect.any(String),
      });

      const refreshed = await http
        .post(`${API}/platform/user/refresh`)
        .set('x-client-type', 'desktop')
        .send({ refreshToken: login.body.refreshToken })
        .expect(200);
      await http
        .post(`${API}/platform/user/refresh`)
        .set('x-client-type', 'desktop')
        .set('refresh-token', refreshed.body.refreshToken)
        .expect(200);

      await http
        .post(`${API}/platform/user/logout`)
        .set('x-client-type', 'desktop')
        .send({ refreshToken: login.body.refreshToken })
        .expect(204);
    });

    it('keeps user and platform tokens apart', async () => {
      const staff = await createPlatformUser();
      const seeded = await createBusinessWithOwner();
      const platformLogin = await http
        .post(`${API}/platform/user/login`)
        .set('x-client-type', 'desktop')
        .send({ email: staff.email, password: TEST_PASSWORD })
        .expect(200);
      const userLogin = await desktopLogin(seeded).expect(200);

      // A business-user token is not accepted on a platform route...
      await http
        .get(`${API}/platform`)
        .set('Authorization', `Bearer ${userLogin.body.accessToken}`)
        .set('x-client-type', 'web')
        .expect(401);
      // ...and a platform token is not accepted on a business-user route.
      await http
        .get(`${API}/authentication/me`)
        .set('Authorization', `Bearer ${platformLogin.body.accessToken}`)
        .set('x-client-type', 'web')
        .expect(401);
      // A platform refresh token cannot refresh a business-user session.
      await http
        .post(`${API}/authentication/refresh`)
        .set('x-client-type', 'desktop')
        .set('x-terminal-id', seeded.terminalId)
        .send({ refreshToken: platformLogin.body.refreshToken })
        .expect(401);
    });
  });
});
