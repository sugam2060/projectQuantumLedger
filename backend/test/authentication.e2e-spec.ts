import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { RedisService } from '../src/redis/redis.service';
import { JwtService } from '@nestjs/jwt';

describe('AuthenticationController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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

      const response = await request(app.getHttpServer())
        .post('/authentication/login')
        .send(loginDto)
        .expect(401);
    });

    it('should reject login with missing password', async () => {
      const loginDto = {
        email: 'test@example.com',
        remember: true,
      };

      const response = await request(app.getHttpServer())
        .post('/authentication/login')
        .send(loginDto)
        .expect(401);
    });
  });
});