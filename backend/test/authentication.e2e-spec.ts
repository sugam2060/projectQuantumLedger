import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { RedisService } from '../src/redis/redis.service';
import { REDIS_CLIENT } from '../src/redis/redis.config';

describe('AuthenticationController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RedisService)
      .useValue({})
      .overrideProvider(REDIS_CLIENT)
      .useValue({ quit: async () => 'OK' })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /authentication/login', () => {
    it('should reject login with missing email', async () => {
      const loginDto = {
        password: 'password123',
        remember: true,
      };

      await request(app.getHttpServer())
        .post('/authentication/login')
        .set('x-terminal-id', '00000000-0000-4000-8000-000000000001')
        .send(loginDto)
        .expect(400);
    });

    it('should reject login with missing password', async () => {
      const loginDto = {
        email: 'test@example.com',
        remember: true,
      };

      await request(app.getHttpServer())
        .post('/authentication/login')
        .set('x-terminal-id', '00000000-0000-4000-8000-000000000001')
        .send(loginDto)
        .expect(400);
    });

    it('requires a terminal ID header', async () => {
      await request(app.getHttpServer())
        .post('/authentication/login')
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(400);
    });

    it('validates custom login headers through the registered global pipe', async () => {
      await request(app.getHttpServer())
        .post('/authentication/login')
        .set('x-client-type', 'invalid')
        .set('x-terminal-id', '00000000-0000-4000-8000-000000000001')
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(400);
    });
  });

  describe('platform authentication endpoints', () => {
    it('validates platform login payloads', async () => {
      await request(app.getHttpServer())
        .post('/platform/user/login')
        .send({ password: 'password123' })
        .expect(400);
    });

    it('requires refresh-token and x-client-type headers', async () => {
      await request(app.getHttpServer())
        .post('/platform/user/refresh')
        .expect(400);
    });
  });

  describe('GET /authentication/me', () => {
    it('requires a valid access token', async () => {
      await request(app.getHttpServer()).get('/authentication/me').expect(401);
    });
  });

  describe('POST /authentication/refresh', () => {
    it('requires the terminal ID header', async () => {
      await request(app.getHttpServer())
        .post('/authentication/refresh')
        .set('x-client-type', 'mobile')
        .send({ refreshToken: 'refresh-token' })
        .expect(400);
    });

    it('rejects a missing refresh token after validating headers', async () => {
      await request(app.getHttpServer())
        .post('/authentication/refresh')
        .set('x-client-type', 'mobile')
        .set('x-terminal-id', '00000000-0000-4000-8000-000000000001')
        .expect(401);
    });
  });
});
