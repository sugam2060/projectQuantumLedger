import { type INestApplication, ValidationPipe } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { appConfig } from './config';

/**
 * Applies the HTTP pipeline shared by `main.ts` and the e2e tests, so tests exercise
 * exactly what production runs. Keep every Express-level setting here, not in main.ts.
 */
export function configureApp<T extends INestApplication>(app: T): T {
  const config = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  const express = app as unknown as NestExpressApplication;

  app.enableShutdownHooks();

  // req.ip and req.secure are only trustworthy when this matches the proxies in front.
  express.set('trust proxy', config.trustProxy);

  app.setGlobalPrefix(config.apiPrefix);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validateCustomDecorators: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  return app;
}
