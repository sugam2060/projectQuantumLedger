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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
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
        .send(loginDto)
        .expect(400);
    });
  });
});
