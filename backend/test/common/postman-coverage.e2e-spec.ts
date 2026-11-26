import type { TestingModule } from '@nestjs/testing';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectRoutes, compileAppForRoutes } from './helpers/collect-routes';

/**
 * The Postman collections in test/postman must cover every controller route, and
 * every request in them must name a route that exists. Adding, changing or
 * removing an endpoint without updating Postman fails this test.
 */
const POSTMAN_DIR = join(process.cwd(), 'test', 'postman');

type PostmanItem = {
  name: string;
  item?: PostmanItem[];
  request?: { method: string; url: { path?: string[] } | string };
};

/** "GET /businesses/:param/members" for any path variable or {{variable}}. */
function routeKey(method: string, segments: string[]): string {
  const path = segments
    .filter((segment) => segment.length > 0)
    .map((segment) =>
      segment.startsWith(':') || /^\{\{.+\}\}$/.test(segment)
        ? ':param'
        : segment,
    )
    .join('/');
  return `${method.toUpperCase()} /${path}`;
}

function postmanRequests(): { key: string; where: string }[] {
  const found: { key: string; where: string }[] = [];
  const walk = (items: PostmanItem[], trail: string[], file: string) => {
    for (const item of items) {
      if (item.item) {
        walk(item.item, [...trail, item.name], file);
        continue;
      }
      if (!item.request) continue;
      const url = item.request.url;
      const segments =
        typeof url === 'string'
          ? url.split('?')[0].replace('{{baseUrl}}', '').split('/')
          : (url.path ?? []);
      found.push({
        key: routeKey(item.request.method, segments),
        where: `${file} > ${[...trail, item.name].join(' > ')}`,
      });
    }
  };
  for (const file of readdirSync(POSTMAN_DIR).filter((name) =>
    name.endsWith('.postman_collection.json'),
  )) {
    const collection = JSON.parse(
      readFileSync(join(POSTMAN_DIR, file), 'utf8'),
    ) as { item: PostmanItem[] };
    walk(collection.item, [], file);
  }
  return found;
}

describe('Postman collections', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await compileAppForRoutes();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('cover every controller route and nothing else', () => {
    const routes = new Set(
      collectRoutes(moduleRef).map((route) =>
        routeKey(route.method, route.path.split('/')),
      ),
    );
    const requests = postmanRequests();
    const covered = new Set(requests.map((request) => request.key));

    expect(requests.length).toBeGreaterThan(0);
    expect([...routes].filter((route) => !covered.has(route)).sort()).toEqual(
      [],
    );
    expect(
      requests
        .filter((request) => !routes.has(request.key))
        .map((request) => `${request.key} (${request.where})`),
    ).toEqual([]);
  });
});
