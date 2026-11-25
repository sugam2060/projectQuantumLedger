import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { EMAIL_QUEUE } from '../../src/jobs/email/types';
import type { MailJob } from '../../src/jobs/email/types';
import { createTestApp } from '../common/helpers/create-test-app';
import {
  createPlatformUser,
  TEST_PASSWORD,
} from '../database/helpers/factories';
import { closePools, owner, truncateAll } from '../database/helpers/test-db';

const API = '/api/v1';

/**
 * The tenant journey through the real stack and RLS: Fortis staff provision a
 * requested business, the owner redeems the emailed code, signs in on the first
 * terminal and manages the business. Another business stays invisible.
 */
describe('tenant journey (real database)', () => {
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

  async function insertBusinessRequest(email: string): Promise<string> {
    const { rows } = await owner().query<{ id: string }>(
      `INSERT INTO business_provisioning_requests
         (legal_name, display_name, documents, address, primary_contact_name,
          primary_contact_email, primary_contact_phone)
       VALUES ('Journey Retail Pvt. Ltd.', 'Journey Retail',
         '{"panCard":{"frontImage":{"fileId":"f","url":"https://x/f"},"backImage":{"fileId":"b","url":"https://x/b"}},"businessRegistrationCertificate":{"fileId":"c","url":"https://x/c"}}',
         '{"country":"NP","city":"Kathmandu","postalCode":"44600","addressLine1":"Street 1","addressLine2":null}',
         'Journey Owner', $1, '+9779800000000')
       RETURNING id`,
      [email],
    );
    return rows[0].id;
  }

  async function staffToken(): Promise<string> {
    const staff = await createPlatformUser();
    const login = await http
      .post(`${API}/platform/user/login`)
      .set('x-client-type', 'desktop')
      .send({ email: staff.email, password: TEST_PASSWORD })
      .expect(200);
    return login.body.accessToken as string;
  }

  async function provision(token: string, ownerEmail: string, pan: string) {
    const requestId = await insertBusinessRequest(ownerEmail);
    const provisioned = await http
      .post(`${API}/platform/businesses/create`)
      .query({ requested_business_id: requestId })
      .set('Authorization', `Bearer ${token}`)
      .set('x-client-type', 'web')
      .set('idempotency-key', `provision-${pan}`)
      .send({ pan })
      .expect(201);
    const mail = queued.find(
      (job) => job.template === 'redeem-code' && job.to === ownerEmail,
    );
    expect(mail).toBeDefined();
    return {
      businessId: provisioned.body.businessId as string,
      context: mail!.context as {
        redeemCode: string;
        branchId: string;
        terminalCode: string;
      },
    };
  }

  it('provisions, registers the owner, signs in and manages the business', async () => {
    const token = await staffToken();
    const email = 'journey-owner@fortis.test';
    const { businessId, context } = await provision(token, email, 'ABCDE1234F');

    const registered = await http
      .post(`${API}/authentication/register-owner`)
      .set('x-client-type', 'web')
      .send({
        email,
        name: 'Journey Owner',
        password: 'Owner-Password-123',
        redeemCode: context.redeemCode,
        businessId,
        branchId: context.branchId,
        terminalCode: context.terminalCode,
      })
      .expect(201);
    expect(registered.body).toMatchObject({ businessId, isOwner: true });
    const terminalId = registered.body.initialTerminalId as string;

    const login = await http
      .post(`${API}/authentication/login`)
      .set('x-client-type', 'desktop')
      .set('x-terminal-id', terminalId)
      .send({ email, password: 'Owner-Password-123' })
      .expect(200);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };

    const profile = await http
      .get(`${API}/businesses/${businessId}`)
      .set(auth)
      .set('x-client-type', 'desktop')
      .expect(200);
    expect(profile.body).toMatchObject({ id: businessId, isActive: true });

    const branches = await http
      .get(`${API}/businesses/${businessId}/branches`)
      .set(auth)
      .set('x-client-type', 'desktop')
      .expect(200);
    expect(branches.body.items).toEqual([
      expect.objectContaining({ id: context.branchId }),
    ]);

    // Staff add a second branch; the owner activates its terminal.
    const branch = await http
      .post(`${API}/platform/businesses/${businessId}/branches`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-client-type', 'web')
      .set('idempotency-key', 'branch-2')
      .send({ name: 'Second', code: 'SECOND' })
      .expect(201);
    const newTerminal = branch.body.terminals[0] as { terminalCode: string };
    await http
      .post(
        `${API}/businesses/${businessId}/branches/${branch.body.branch.id}/terminals/activate`,
      )
      .set(auth)
      .set('x-client-type', 'desktop')
      .send({ terminalCode: newTerminal.terminalCode })
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('active');
      });
  });

  it('keeps a second business invisible to the first owner', async () => {
    const token = await staffToken();
    const first = await provision(token, 'first@fortis.test', 'FIRST1234F');
    const second = await provision(token, 'second@fortis.test', 'SECND1234F');

    const registered = await http
      .post(`${API}/authentication/register-owner`)
      .set('x-client-type', 'web')
      .send({
        email: 'first@fortis.test',
        name: 'First',
        password: 'Owner-Password-123',
        redeemCode: first.context.redeemCode,
        businessId: first.businessId,
        branchId: first.context.branchId,
        terminalCode: first.context.terminalCode,
      })
      .expect(201);
    const login = await http
      .post(`${API}/authentication/login`)
      .set('x-client-type', 'desktop')
      .set('x-terminal-id', registered.body.initialTerminalId)
      .send({ email: 'first@fortis.test', password: 'Owner-Password-123' })
      .expect(200);

    await http
      .get(`${API}/businesses/${second.businessId}`)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .set('x-client-type', 'desktop')
      .expect(403);
  });
});
