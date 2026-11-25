import type { INestApplication } from '@nestjs/common';
import { API_PREFIX } from './config';
import { cookieParserMiddleware } from './utils/cookie-parser.middleware';
import { RateLimitMiddleware } from './utils/ratelimit.middleware';

/**
 * Applies the HTTP pipeline shared by `main.ts` and the e2e tests, so tests exercise
 * exactly what production runs. Keep every Express-level setting here, not in main.ts.
 */
export function configureApp(app: INestApplication): INestApplication {
  app.enableShutdownHooks();

  // Populate req.cookies before the global JWT guard reads web access tokens.
  app.use(cookieParserMiddleware);

  app.setGlobalPrefix(API_PREFIX);

  // Use Nest's managed instance so its heartbeat is stopped during shutdown.
  const rateLimitMiddleware = app.get(RateLimitMiddleware);
  app.use(rateLimitMiddleware.use.bind(rateLimitMiddleware));

  return app;
}
