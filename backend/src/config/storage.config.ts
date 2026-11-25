import { registerAs } from '@nestjs/config';
import { readString } from './env.util';
import type { StorageConfig } from './types';

const DEFAULT_BUSINESS_REQUEST_FOLDER = 'business-request-documents';

/**
 * Object storage (Cloudinary). Credentials are optional at startup: the storage
 * service answers 503 when an upload is attempted without them.
 */
export const storageConfig = registerAs('storage', (): StorageConfig => ({
  cloudinary: {
    cloudName: readString('CLOUDINARY_CLOUD_NAME'),
    apiKey: readString('CLOUDINARY_API_KEY'),
    apiSecret: readString('CLOUDINARY_API_SECRET'),
    businessRequestFolder:
      readString('CLOUDINARY_BUSINESS_REQUEST_FOLDER') ??
      DEFAULT_BUSINESS_REQUEST_FOLDER,
  },
}));
