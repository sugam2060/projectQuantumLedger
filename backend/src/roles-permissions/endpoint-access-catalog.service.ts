import { Injectable, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { REQUIRED_ROLES } from '../authentication/decorators/required_permission.decorator';

export interface EndpointAccessCatalogEntry {
  endpointKey: string;
  controller: string;
  method: string;
  path: string;
}

@Injectable()
export class EndpointAccessCatalogService {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  list(): EndpointAccessCatalogEntry[] {
    const entries: EndpointAccessCatalogEntry[] = [];

    for (const wrapper of this.discovery.getControllers()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      const controllerClass = wrapper.metatype;
      if (!instance || !controllerClass) continue;

      const controllerPath = Reflect.getMetadata(
        PATH_METADATA,
        controllerClass,
      );
      const methodNames = this.scanner.getAllMethodNames(
        Object.getPrototypeOf(instance) as object,
      );

      for (const methodName of methodNames) {
        const handler = instance[methodName];
        if (typeof handler !== 'function') continue;

        const endpointKey = this.reflector.get<string>(REQUIRED_ROLES, handler);
        if (!endpointKey) continue;

        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        const routePath = Reflect.getMetadata(PATH_METADATA, handler);
        const paths = [controllerPath, routePath]
          .flatMap((path) => (Array.isArray(path) ? path : [path]))
          .filter((path): path is string => typeof path === 'string')
          .map((path) => path.replace(/^\/+|\/+$/g, ''))
          .filter(Boolean);

        entries.push({
          endpointKey,
          controller: controllerClass.name,
          method:
            method === undefined
              ? 'UNKNOWN'
              : RequestMethod[method].toUpperCase(),
          path: `/${paths.join('/')}`,
        });
      }
    }

    return entries.sort((left, right) =>
      left.endpointKey.localeCompare(right.endpointKey),
    );
  }

  has(endpointKey: string): boolean {
    return this.list().some((entry) => entry.endpointKey === endpointKey);
  }
}
