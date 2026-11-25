export interface StoredObject {
  fileId: string;
  url: string;
  resourceType: string;
  format: string | null;
}

/** Storage operations used by features without binding them to a provider. */
export abstract class ObjectStoreService {
  abstract upload(file: Express.Multer.File): Promise<StoredObject>;
  abstract update(
    fileId: string,
    file: Express.Multer.File,
  ): Promise<StoredObject>;
  abstract get(fileId: string): Promise<StoredObject>;
  abstract delete(fileId: string): Promise<void>;
  abstract getFolder(): string;
}
