/** Shape of the `storage` config namespace (see `storage.config.ts`). */
export type StorageConfig = {
  cloudinary: {
    cloudName: string | undefined;
    apiKey: string | undefined;
    apiSecret: string | undefined;
    businessRequestFolder: string;
  };
};
