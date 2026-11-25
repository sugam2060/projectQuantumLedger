import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/app.setup';

/**
 * Boots the real AppModule through `configureApp`, i.e. the same HTTP pipeline as
 * production (prefix, helmet, cookies, CORS, validation, error filter). Pass
 * `override` to swap providers (e.g. the email queue) for a test.
 */
export async function createTestApp(
  override: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
): Promise<INestApplication> {
  const moduleRef = await override(
    Test.createTestingModule({ imports: [AppModule] }),
  ).compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  return app;
}
