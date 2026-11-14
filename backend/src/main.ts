import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis/redis.service';
import { RateLimitKeyGenerator } from './utils/rate-limit-key.generator';
import { RateLimitMiddleware } from './utils/ratelimit.middleware';
import { cookieParserMiddleware } from './utils/cookie-parser.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  // Populate req.cookies before the global JWT guard reads web access tokens.
  app.use(cookieParserMiddleware);

  // Set global prefix
  app.setGlobalPrefix('/api/v1');

  // Resolve dependencies and add rate limiting middleware
  const redisService = app.get(RedisService);
  const configService = app.get(ConfigService);
  const rateLimitKeyGenerator = app.get(RateLimitKeyGenerator);

  const rateLimitMiddleware = new RateLimitMiddleware(
    redisService,
    configService,
    rateLimitKeyGenerator,
  );

  app.use(rateLimitMiddleware.use.bind(rateLimitMiddleware));

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001; // Use port 3001 as fallback
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
void bootstrap();
