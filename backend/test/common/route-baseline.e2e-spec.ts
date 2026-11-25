import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
} from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../../src/app.module';
import { REDIS_CLIENT } from '../../src/redis/redis.constants';
import { getQueueToken } from '@nestjs/bullmq';
import { EMAIL_QUEUE } from '../../src/jobs/email/types';

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

const joinPath = (...parts: string[]): string =>
  '/' +
  parts
    .flatMap((part) => part.split('/'))
    .filter((segment) => segment.length > 0)
    .join('/');

const toArray = (value: string | string[] | undefined): string[] =>
  value === undefined ? [''] : Array.isArray(value) ? value : [value];

describe('Route baseline', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    })
      .overrideProvider(REDIS_CLIENT)
      .useValue({ quit: async () => 'OK' })
      .overrideProvider(getQueueToken(EMAIL_QUEUE))
      .useValue({ add: async () => undefined })
      .compile();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('matches the recorded route list', () => {
    const discovery = moduleRef.get(DiscoveryService);
    const scanner = moduleRef.get(MetadataScanner);
    const routes: RouteEntry[] = [];

    for (const wrapper of discovery.getControllers()) {
      const controller = wrapper.metatype;
      const instance: unknown = wrapper.instance;
      if (!controller || !instance || typeof instance !== 'object') continue;
      const controllerPaths = toArray(
        Reflect.getMetadata(PATH_METADATA, controller) as
          string | string[] | undefined,
      );
      const classPublic =
        Reflect.getMetadata(IS_PUBLIC_METADATA_KEY, controller) === true;
      const prototype = Object.getPrototypeOf(instance) as object;

      for (const methodName of scanner.getAllMethodNames(prototype)) {
        const handler = (prototype as Record<string, unknown>)[methodName];
        if (typeof handler !== 'function') continue;
        const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as
          string | string[] | undefined;
        if (methodPath === undefined) continue;
        const requestMethod = Reflect.getMetadata(
          METHOD_METADATA,
          handler,
        ) as RequestMethod;
        const isPublic =
          classPublic ||
          Reflect.getMetadata(IS_PUBLIC_METADATA_KEY, handler) === true;
        for (const base of controllerPaths) {
          for (const sub of toArray(methodPath)) {
            routes.push({
              method: RequestMethod[requestMethod],
              path: joinPath(base, sub),
              public: isPublic,
            });
          }
        }
      }
    }

    routes.sort((a, b) =>
      a.path === b.path
        ? a.method.localeCompare(b.method)
        : a.path.localeCompare(b.path),
    );

    if (process.env.UPDATE_ROUTE_BASELINE === '1') {
      writeFileSync(FIXTURE_PATH, `${JSON.stringify(routes, null, 2)}\n`);
    }
    const expected = JSON.parse(
      readFileSync(FIXTURE_PATH, 'utf8'),
    ) as RouteEntry[];
    expect(routes).toEqual(expected);
  });
});
