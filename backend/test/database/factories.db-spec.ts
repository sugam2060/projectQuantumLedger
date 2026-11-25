import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { EMAIL_QUEUE } from '../../src/jobs/email/types';
import { createTestApp } from '../common/helpers/create-test-app';
import { createBusinessWithOwner, TEST_PASSWORD } from './helpers/factories';
import { closePools, owner, truncateAll } from './helpers/test-db';

/**
 * Smoke test for the test infrastructure: factories write real rows and the full
 * app (real Postgres, real Redis) can sign an owner in against them.
 */
describe('test infrastructure', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder
        .overrideProvider(getQueueToken(EMAIL_QUEUE))
        .useValue({ add: async () => undefined }),
    );
  });

  beforeEach(truncateAll);

  afterAll(async () => {
    await app.close();
    await closePools();
  });

  it('creates a business with an owner', async () => {
    const seeded = await createBusinessWithOwner();
    const { rows } = await owner().query(
      'SELECT is_owner FROM business_memberships WHERE user_id = $1',
      [seeded.owner.id],
    );
    expect(rows).toEqual([{ is_owner: true }]);
  });

  it('signs the owner in through the real stack', async () => {
    const seeded = await createBusinessWithOwner();
    const response = await request(app.getHttpServer())
      .post('/api/v1/authentication/login')
      .set('x-client-type', 'desktop')
      .set('x-terminal-id', seeded.terminalId)
      .send({ email: seeded.owner.email, password: TEST_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      accessToken: expect.any(String),
      tokenType: 'Bearer',
    });
  });
});
