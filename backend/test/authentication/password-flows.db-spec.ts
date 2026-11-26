import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { EMAIL_QUEUE } from '../../src/jobs/email/types';
import type { MailJob } from '../../src/jobs/email/types';
import { createTestApp } from '../common/helpers/create-test-app';
import {
  createBusinessWithOwner,
  createPlatformUser,
  createUser,
  TEST_PASSWORD,
} from '../database/helpers/factories';
import { closePools, owner, truncateAll } from '../database/helpers/test-db';

const API = '/api/v1';
const NEW_PASSWORD = 'Brand-New-Password-42';

describe('password flows (real database)', () => {
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

  function login(
    seeded: { terminalId: string; owner: { email: string } },
    password = TEST_PASSWORD,
  ) {
    return http
      .post(`${API}/authentication/login`)
      .set('x-client-type', 'desktop')
      .set('x-terminal-id', seeded.terminalId)
      .send({ email: seeded.owner.email, password });
  }

  function refresh(seeded: { terminalId: string }, refreshToken: string) {
    return http
      .post(`${API}/authentication/refresh`)
      .set('x-client-type', 'desktop')
      .set('x-terminal-id', seeded.terminalId)
      .send({ refreshToken });
  }

  /** Waits for the background reset email to be queued. */
  async function waitForMail(email: string): Promise<MailJob> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const mail = queued.find(
        (job) => job.template === 'password-reset' && job.to === email,
      );
      if (mail) return mail;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`no reset email for ${email}`);
  }

  /** The token embedded in the queued reset email's link. */
  async function resetTokenFor(email: string): Promise<string> {
    const mail = await waitForMail(email);
    return (
      new URL(String(mail.context.resetUrl)).searchParams.get('token') ?? ''
    );
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  describe('forgot + reset', () => {
    it('answers 202 for known and unknown emails, emailing only real accounts', async () => {
      const seeded = await createBusinessWithOwner();
      const known = await http
        .post(`${API}/authentication/forgot-password`)
        .send({ email: seeded.owner.email.toUpperCase() })
        .expect(202);
      const unknown = await http
        .post(`${API}/authentication/forgot-password`)
        .send({ email: 'nobody@fortis.test' })
        .expect(202);

      expect(known.body).toEqual(unknown.body);
      await waitForMail(seeded.owner.email);
      await settle();
      expect(queued).toHaveLength(1);
      expect(String(queued[0].context.resetUrl)).toMatch(
        /^https:\/\/app\.fortis\.test\/reset-password\?token=[A-Za-z0-9_-]{43}$/,
      );
      const { rows } = await owner().query<{ token_hash: string }>(
        'SELECT token_hash FROM password_reset_tokens',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].token_hash).not.toBe(
        await resetTokenFor(seeded.owner.email),
      );
    });

    it('does not email disabled accounts', async () => {
      const disabled = await createUser({ status: 'disabled' });
      await http
        .post(`${API}/authentication/forgot-password`)
        .send({ email: disabled.email })
        .expect(202);
      await settle();
      expect(queued).toHaveLength(0);
    });

    it('resets once, signs out every device and lets the new password in', async () => {
      const seeded = await createBusinessWithOwner();
      const session = await login(seeded).expect(200);
      await http
        .post(`${API}/authentication/forgot-password`)
        .send({ email: seeded.owner.email })
        .expect(202);
      const token = await resetTokenFor(seeded.owner.email);

      await http
        .post(`${API}/authentication/reset-password`)
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(204);

      await refresh(seeded, session.body.refreshToken).expect(401);
      await login(seeded).expect(401);
      await login(seeded, NEW_PASSWORD).expect(200);
      await http
        .post(`${API}/authentication/reset-password`)
        .send({ token, newPassword: 'Another-Password-77' })
        .expect(400);
    });

    it('invalidates an older link when a new one is requested', async () => {
      const seeded = await createBusinessWithOwner();
      await http
        .post(`${API}/authentication/forgot-password`)
        .send({ email: seeded.owner.email });
      const first = await resetTokenFor(seeded.owner.email);
      queued.length = 0;
      await owner().query(
        "UPDATE password_reset_tokens SET created_at = now() - interval '2 minutes'",
      );
      await http
        .post(`${API}/authentication/forgot-password`)
        .send({ email: seeded.owner.email });

      await waitForMail(seeded.owner.email);
      await http
        .post(`${API}/authentication/reset-password`)
        .send({ token: first, newPassword: NEW_PASSWORD })
        .expect(400);
    });

    it('does not replace a link issued less than a minute ago', async () => {
      const seeded = await createBusinessWithOwner();
      await http
        .post(`${API}/authentication/forgot-password`)
        .send({ email: seeded.owner.email });
      const first = await resetTokenFor(seeded.owner.email);
      queued.length = 0;
      await http
        .post(`${API}/authentication/forgot-password`)
        .send({ email: seeded.owner.email })
        .expect(202);
      await settle();
      expect(queued).toHaveLength(0);
      await http
        .post(`${API}/authentication/reset-password`)
        .send({ token: first, newPassword: NEW_PASSWORD })
        .expect(204);
    });

    it('rejects short new passwords and malformed tokens', async () => {
      await http
        .post(`${API}/authentication/reset-password`)
        .send({ token: 'x'.repeat(43), newPassword: 'short' })
        .expect(400);
      await http
        .post(`${API}/authentication/reset-password`)
        .send({ token: 'not-a-token', newPassword: NEW_PASSWORD })
        .expect(400);
    });
  });

  describe('change password', () => {
    it('requires the right current password and a different new one', async () => {
      const seeded = await createBusinessWithOwner();
      const session = await login(seeded).expect(200);
      const auth = { Authorization: `Bearer ${session.body.accessToken}` };

      await http
        .post(`${API}/authentication/change-password`)
        .set(auth)
        .send({ newPassword: NEW_PASSWORD })
        .expect(400);
      await http
        .post(`${API}/authentication/change-password`)
        .set(auth)
        .send({
          currentPassword: 'Wrong-password-1',
          newPassword: NEW_PASSWORD,
        })
        .expect(403);
      await http
        .post(`${API}/authentication/change-password`)
        .set(auth)
        .send({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD })
        .expect(400);
    });

    it('changes the password, ends other sessions and returns a new one', async () => {
      const seeded = await createBusinessWithOwner();
      const thisDevice = await login(seeded).expect(200);
      const otherDevice = await login(seeded).expect(200);

      const changed = await http
        .post(`${API}/authentication/change-password`)
        .set('Authorization', `Bearer ${thisDevice.body.accessToken}`)
        .set('x-client-type', 'desktop')
        .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);

      expect(changed.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      });
      await refresh(seeded, otherDevice.body.refreshToken).expect(401);
      await refresh(seeded, thisDevice.body.refreshToken).expect(401);
      await refresh(seeded, changed.body.refreshToken).expect(200);
      await login(seeded, NEW_PASSWORD).expect(200);
    });
  });

  describe('platform users', () => {
    it('resets and changes a staff password', async () => {
      const staff = await createPlatformUser();
      await http
        .post(`${API}/platform/user/forgot-password`)
        .send({ email: staff.email })
        .expect(202);
      const mail = await waitForMail(staff.email);
      const token =
        new URL(String(mail.context.resetUrl)).searchParams.get('token') ?? '';
      expect(String(mail.context.resetUrl)).toContain(
        '/platform/reset-password?token=',
      );
      await http
        .post(`${API}/platform/user/reset-password`)
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(204);

      const signedIn = await http
        .post(`${API}/platform/user/login`)
        .set('x-client-type', 'desktop')
        .send({ email: staff.email, password: NEW_PASSWORD })
        .expect(200);
      await http
        .post(`${API}/platform/user/change-password`)
        .set('Authorization', `Bearer ${signedIn.body.accessToken}`)
        .set('x-client-type', 'desktop')
        .send({ currentPassword: NEW_PASSWORD, newPassword: TEST_PASSWORD })
        .expect(200);
    });

    it('does not accept a business-user reset token for a staff account', async () => {
      const seeded = await createBusinessWithOwner();
      await http
        .post(`${API}/authentication/forgot-password`)
        .send({ email: seeded.owner.email });
      await http
        .post(`${API}/platform/user/reset-password`)
        .send({
          token: await resetTokenFor(seeded.owner.email),
          newPassword: NEW_PASSWORD,
        })
        .expect(400);
    });
  });
});
