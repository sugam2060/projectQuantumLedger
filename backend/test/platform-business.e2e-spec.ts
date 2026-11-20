import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Test as SupertestTest } from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import { PlatformBusinessController } from '../src/platform-business/platform-business.controller';
import { PlatformBusinessService } from '../src/platform-business/platform-business.service';

describe('PlatformBusinessController (e2e)', () => {
  let app: INestApplication;
  const platformBusiness = {
    submitBusinessRequest: jest.fn(),
    provisionBusiness: jest.fn(),
    createBranch: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PlatformBusinessController],
      providers: [
        { provide: PlatformBusinessService, useValue: platformBusiness },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        validateCustomDecorators: true,
      }),
    );
    app.use(
      (
        request: Request & {
          user?: { isPlatform: boolean; platformUserId: string };
        },
        _response: Response,
        next: NextFunction,
      ) => {
        request.user = {
          isPlatform: request.header('x-test-platform') !== 'false',
          platformUserId: '00000000-0000-4000-8000-000000000009',
        };
        next();
      },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    platformBusiness.submitBusinessRequest.mockResolvedValue(undefined);
    platformBusiness.provisionBusiness.mockResolvedValue({
      message:
        'Business Example Retail has been verified. Redeem code has been sent to owner.',
      businessId: '00000000-0000-4000-8000-000000000010',
      ownerActivationInvitationStatus: 'queued',
    });
    platformBusiness.createBranch.mockResolvedValue({
      branch: {
        id: '00000000-0000-4000-8000-000000000010',
        name: 'Downtown Branch',
      },
      terminals: [
        {
          id: '00000000-0000-4000-8000-000000000011',
          name: 'Front Counter',
          terminalCode: 'POS-01',
        },
        {
          id: '00000000-0000-4000-8000-000000000012',
          name: 'Cafe Counter',
          terminalCode: 'POS-02',
        },
      ],
    });
  });

  function fillRequest(form: SupertestTest) {
    return form
      .field('legalName', 'Example Retail Pvt. Ltd.')
      .field('displayName', 'Example Retail')
      .field('country', 'NP')
      .field('city', 'Kathmandu')
      .field('postalCode', '123123123')
      .field('addressLine1', 'Address line 1')
      .field('primaryContactName', 'Example Owner')
      .field('primaryContactEmail', 'owner@example.com')
      .field('primaryContactPhone', '+9779812345678')
      .attach('panCardFront', Buffer.from('%PDF-pan-front'), {
        filename: 'pan-front.pdf',
        contentType: 'application/pdf',
      })
      .attach('panCardBack', Buffer.from('%PDF-pan-back'), {
        filename: 'pan-back.pdf',
        contentType: 'application/pdf',
      })
      .attach(
        'businessRegistrationCertificate',
        Buffer.from('%PDF-registration'),
        { filename: 'registration.pdf', contentType: 'application/pdf' },
      );
  }

  it('uploads documents and submits the request through one web endpoint', async () => {
    await fillRequest(
      request(app.getHttpServer()).post('/platform/businesses/request'),
    )
      .set('x-client-type', 'web')
      .expect(201)
      .expect({
        message:
          'Your request has been submitted. Our team will contact you for further process.',
      });

    expect(platformBusiness.submitBusinessRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        legalName: 'Example Retail Pvt. Ltd.',
        city: 'Kathmandu',
        primaryContactEmail: 'owner@example.com',
      }),
      expect.objectContaining({
        panCardFront: expect.objectContaining({
          originalname: 'pan-front.pdf',
        }),
        panCardBack: expect.objectContaining({ originalname: 'pan-back.pdf' }),
        businessRegistrationCertificate: expect.objectContaining({
          originalname: 'registration.pdf',
        }),
      }),
      expect.objectContaining({
        endpointPath: '/platform/businesses/request',
        method: 'POST',
      }),
    );
  });

  it('rejects non-web clients, invalid JSON form fields, and missing files', async () => {
    await fillRequest(
      request(app.getHttpServer()).post('/platform/businesses/request'),
    )
      .set('x-client-type', 'desktop')
      .expect(400);

    await request(app.getHttpServer())
      .post('/platform/businesses/request')
      .set('x-client-type', 'web')
      .field('legalName', 'Example')
      .field('displayName', 'Store')
      .field('country', 'NP')
      .field('city', 'Kathmandu')
      .field('postalCode', '123123123')
      .field('addressLine1', 'Address line 1')
      .field('primaryContactName', 'Example Owner')
      .field('primaryContactEmail', 'bad-email')
      .field('primaryContactPhone', '+9779812345678')
      .attach('panCardFront', Buffer.from('%PDF-pan-front'), {
        filename: 'pan-front.pdf',
        contentType: 'application/pdf',
      })
      .attach('panCardBack', Buffer.from('%PDF-pan-back'), {
        filename: 'pan-back.pdf',
        contentType: 'application/pdf',
      })
      .attach(
        'businessRegistrationCertificate',
        Buffer.from('%PDF-registration'),
        { filename: 'registration.pdf', contentType: 'application/pdf' },
      )
      .expect(400);

    await request(app.getHttpServer())
      .post('/platform/businesses/request')
      .set('x-client-type', 'web')
      .field('legalName', 'Example')
      .field('displayName', 'Store')
      .field('country', 'NP')
      .field('city', 'Kathmandu')
      .field('postalCode', '123123123')
      .field('addressLine1', 'Address line 1')
      .field('primaryContactName', 'Example Owner')
      .field('primaryContactEmail', 'owner@example.com')
      .field('primaryContactPhone', '+9779812345678')
      .expect(400);

    expect(platformBusiness.submitBusinessRequest).not.toHaveBeenCalled();
  });

  it('validates and provisions a requested business for an authenticated platform user', async () => {
    await request(app.getHttpServer())
      .post('/platform/businesses/create')
      .query({ requested_business_id: '00000000-0000-4000-8000-000000000001' })
      .set('x-client-type', 'web')
      .set('idempotency-key', 'provision-e2e-001')
      .send({ pan: 'ABCDE1234F', ownerEmail: 'owner@example.com' })
      .expect(201)
      .expect((response) => {
        expect(response.body.businessId).toBe(
          '00000000-0000-4000-8000-000000000010',
        );
        expect(response.body.ownerActivationInvitationStatus).toBe('queued');
      });

    expect(platformBusiness.provisionBusiness).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      { pan: 'ABCDE1234F', ownerEmail: 'owner@example.com' },
      'provision-e2e-001',
      '00000000-0000-4000-8000-000000000009',
      expect.objectContaining({
        endpointPath: '/platform/businesses/create',
        method: 'POST',
      }),
    );
  });

  it('rejects provisioning requests with an invalid query, missing key, or non-web client', async () => {
    const url = '/platform/businesses/create?requested_business_id=not-a-uuid';
    await request(app.getHttpServer())
      .post(url)
      .set('x-client-type', 'web')
      .set('idempotency-key', 'key-e2e-002')
      .send({ pan: 'ABCDE1234F' })
      .expect(400);

    await request(app.getHttpServer())
      .post(
        '/platform/businesses/create?requested_business_id=00000000-0000-4000-8000-000000000001',
      )
      .set('x-client-type', 'web')
      .send({ pan: 'ABCDE1234F' })
      .expect(400);

    await request(app.getHttpServer())
      .post(
        '/platform/businesses/create?requested_business_id=00000000-0000-4000-8000-000000000001',
      )
      .set('x-client-type', 'desktop')
      .set('idempotency-key', 'key-e2e-003')
      .send({ pan: 'ABCDE1234F' })
      .expect(400);
  });

  it('creates a branch with multiple named terminals for a platform user', async () => {
    const businessId = '00000000-0000-4000-8000-000000000001';
    const body = {
      name: 'Downtown Branch',
      code: 'DOWNTOWN',
      terminals: [{ name: 'Front Counter' }, { name: 'Cafe Counter' }],
    };
    await request(app.getHttpServer())
      .post(`/platform/businesses/${businessId}/branches`)
      .set('x-client-type', 'web')
      .set('idempotency-key', 'branch-create-e2e-001')
      .send(body)
      .expect(201)
      .expect(({ body: responseBody }) => {
        expect(responseBody.branch).toEqual({
          id: '00000000-0000-4000-8000-000000000010',
          name: 'Downtown Branch',
        });
        expect(
          responseBody.terminals.map(
            (terminal: { terminalCode: string }) => terminal.terminalCode,
          ),
        ).toEqual(['POS-01', 'POS-02']);
      });

    expect(platformBusiness.createBranch).toHaveBeenCalledWith(
      businessId,
      body,
      'branch-create-e2e-001',
      '00000000-0000-4000-8000-000000000009',
      expect.objectContaining({
        endpointPath: '/platform/businesses/:businessId/branches',
        method: 'POST',
      }),
    );
  });

  it('rejects non-platform users and invalid branch creation input', async () => {
    const path =
      '/platform/businesses/00000000-0000-4000-8000-000000000001/branches';
    const validBody = { name: 'Downtown Branch', code: 'DOWNTOWN' };
    await request(app.getHttpServer())
      .post(path)
      .set('x-test-platform', 'false')
      .set('x-client-type', 'web')
      .set('idempotency-key', 'branch-create-e2e-002')
      .send(validBody)
      .expect(403);

    await request(app.getHttpServer())
      .post('/platform/businesses/not-a-uuid/branches')
      .set('x-client-type', 'web')
      .set('idempotency-key', 'branch-create-e2e-003')
      .send(validBody)
      .expect(400);

    await request(app.getHttpServer())
      .post(path)
      .set('x-client-type', 'web')
      .send(validBody)
      .expect(400);

    await request(app.getHttpServer())
      .post(path)
      .set('x-client-type', 'web')
      .set('idempotency-key', 'branch-create-e2e-004')
      .send({ ...validBody, terminals: [] })
      .expect(400);

    expect(platformBusiness.createBranch).not.toHaveBeenCalled();
  });
});
