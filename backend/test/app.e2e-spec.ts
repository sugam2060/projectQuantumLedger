import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { JwtService } from '@nestjs/jwt';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let jwtService: JwtService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    jwtService = app.get(JwtService);
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('rejects protected routes without a JWT', () => {
    return request(app.getHttpServer())
      .post('/onboarding')
      .send({})
      .expect(401);
  });

  it('accepts a valid JWT on protected routes', () => {
    const token = jwtService.sign({
      sub: 'c1f5a8b2-391d-4c72-9bf1-15f3f48a0091',
    });

    return request(app.getHttpServer())
      .post('/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ event: 'test' })
      .expect(202);
  });

  afterEach(async () => {
    await app.close();
  });
});
