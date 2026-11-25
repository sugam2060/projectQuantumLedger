import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { storageConfig } from '../config';
import { CloudinaryObjectStoreService } from './cloudinary-object-store.service';
import { ObjectStoreService } from './object-store.service';

/**
 * Object storage for uploaded documents. Features inject the provider-neutral
 * ObjectStoreService; Cloudinary is the current implementation.
 */
@Module({
  imports: [ConfigModule.forFeature(storageConfig)],
  providers: [
    CloudinaryObjectStoreService,
    { provide: ObjectStoreService, useExisting: CloudinaryObjectStoreService },
  ],
  exports: [ObjectStoreService],
})
export class StorageModule {}
