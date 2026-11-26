import type { TestingModule } from '@nestjs/testing';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectRoutes, compileAppForRoutes } from './helpers/collect-routes';

/**
 * Route baseline: the list of routes (method + path + public flag) the app exposes.
 * Folder moves and layering refactors must not change it. Intentional route changes
 * regenerate it with UPDATE_ROUTE_BASELINE=1 and are listed in CHANGELOG.md.
 *
 * The metadata key is spelled out (not imported) so this test does not depend on
 * where the @Public() decorator file lives.
 */
const IS_PUBLIC_METADATA_KEY = 'isPublic';
// Jest runs with rootDir = backend/ and ESM (no __dirname), so resolve from the cwd.
const FIXTURE_PATH = join(
  process.cwd(),
  'test',
  'common',
  'fixtures',
  'route-baseline.json',
);

type RouteEntry = { method: string; path: string; public: boolean };

describe('Route baseline', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await compileAppForRoutes();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('matches the recorded route list', () => {
    const routes: RouteEntry[] = collectRoutes(moduleRef).map((route) => ({
      method: route.method,
      path: route.path,
      public: route.metadata(IS_PUBLIC_METADATA_KEY) === true,
    }));

    if (process.env.UPDATE_ROUTE_BASELINE === '1') {
      writeFileSync(FIXTURE_PATH, `${JSON.stringify(routes, null, 2)}\n`);
    }
    const expected = JSON.parse(
      readFileSync(FIXTURE_PATH, 'utf8'),
    ) as RouteEntry[];
    expect(routes).toEqual(expected);
  });
});
