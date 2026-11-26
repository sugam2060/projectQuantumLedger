import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
} from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { AppModule } from '../../../src/app.module';
import { EMAIL_QUEUE } from '../../../src/jobs/email/types';
import { REDIS_CLIENT } from '../../../src/redis/redis.constants';

/** One declared route with the metadata the guards read. */
export type CollectedRoute = {
  method: string;
  path: string;
  metadata: (key: string) => unknown;
};

const joinPath = (...parts: string[]): string =>
  '/' +
  parts
    .flatMap((part) => part.split('/'))
    .filter((segment) => segment.length > 0)
    .join('/');

const toArray = (value: string | string[] | undefined): string[] =>
  value === undefined ? [''] : Array.isArray(value) ? value : [value];

/** Compiles AppModule (no Redis or queue connections) for route inspection. */
export function compileAppForRoutes(): Promise<TestingModule> {
  return Test.createTestingModule({ imports: [AppModule, DiscoveryModule] })
    .overrideProvider(REDIS_CLIENT)
    .useValue({ quit: async () => 'OK' })
    .overrideProvider(getQueueToken(EMAIL_QUEUE))
    .useValue({ add: async () => undefined })
    .compile();
}

/**
 * Every controller route without the global `/api/v1` prefix. `metadata(key)`
 * resolves like `Reflector.getAllAndOverride` (handler first, then controller).
 */
export function collectRoutes(moduleRef: TestingModule): CollectedRoute[] {
  const discovery = moduleRef.get(DiscoveryService);
  const scanner = moduleRef.get(MetadataScanner);
  const routes: CollectedRoute[] = [];

  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype;
    const instance: unknown = wrapper.instance;
    if (!controller || !instance || typeof instance !== 'object') continue;
    const controllerPaths = toArray(
      Reflect.getMetadata(PATH_METADATA, controller) as
        string | string[] | undefined,
    );
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
      const metadata = (key: string): unknown =>
        Reflect.getMetadata(key, handler) ??
        Reflect.getMetadata(key, controller);
      for (const base of controllerPaths) {
        for (const sub of toArray(methodPath)) {
          routes.push({
            method: RequestMethod[requestMethod],
            path: joinPath(base, sub),
            metadata,
          });
        }
      }
    }
  }

  return routes.sort((a, b) =>
    a.path === b.path
      ? a.method.localeCompare(b.method)
      : a.path.localeCompare(b.path),
  );
}
