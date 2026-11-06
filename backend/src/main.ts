import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from "@nestjs/config";
import { RedisService } from './redis/redis.service';
import { RateLimitKeyGenerator } from './utils/rate-limit-key.generator';
import { RateLimitMiddleware } from './utils/ratelimit.middleware';


async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Set global prefix
  app.setGlobalPrefix("/api/v1");

  // Resolve dependencies and add rate limiting middleware
  const redisService = app.get(RedisService);
  const configService = app.get(ConfigService);
  const rateLimitKeyGenerator = app.get(RateLimitKeyGenerator);

  const rateLimitMiddleware = new RateLimitMiddleware(
    redisService,
    configService,
    rateLimitKeyGenerator
  );

  app.use(rateLimitMiddleware.use.bind(rateLimitMiddleware));

  // Add global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true
  }));

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001; // Use port 3001 as fallback
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
void bootstrap();
