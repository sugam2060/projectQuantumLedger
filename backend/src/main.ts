import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RateLimitMiddleware } from './utils/ratelimit.middleware';
import { cookieParserMiddleware } from './utils/cookie-parser.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  // Populate req.cookies before the global JWT guard reads web access tokens.
  app.use(cookieParserMiddleware);

  // Set global prefix
  app.setGlobalPrefix('/api/v1');

  // Use Nest's managed instance so its heartbeat is stopped during shutdown.
  const rateLimitMiddleware = app.get(RateLimitMiddleware);
  app.use(rateLimitMiddleware.use.bind(rateLimitMiddleware));

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001; // Use port 3001 as fallback
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
void bootstrap();
