import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { Controller, Post } from '@nestjs/common';
import { MetadataScanner, Reflector } from '@nestjs/core';
import { RequiredRoles } from '../../authentication/decorators/required_permission.decorator';
import { EndpointAccessCatalogService } from '../endpoint-access-catalog.service';

@Controller('inventory')
class InventoryController {
  @Post(':id')
  @RequiredRoles('inventory.create')
  create() {
    return undefined;
  }
}

describe('EndpointAccessCatalogService', () => {
  it('discovers endpoint keys, methods, and paths from decorated handlers', () => {
    const instance = new InventoryController();
    const discovery = {
      getControllers: jest.fn(() => [
        { instance, metatype: InventoryController },
      ]),
    };
    const catalog = new EndpointAccessCatalogService(
      discovery as never,
      new MetadataScanner(),
      new Reflector(),
    );

    expect(catalog.list()).toEqual([
      {
        endpointKey: 'inventory.create',
        controller: 'InventoryController',
        method: 'POST',
        path: '/inventory/:id',
      },
    ]);
    expect(catalog.has('inventory.create')).toBe(true);
    expect(catalog.has('inventory.delete')).toBe(false);
  });
});
