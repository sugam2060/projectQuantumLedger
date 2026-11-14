import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  v2 as cloudinary,
  type UploadApiOptions,
  type UploadApiResponse,
} from 'cloudinary';
import streamifier from 'streamifier';
import { ObjectStoreService, type StoredObject } from './objectStore.service';

@Injectable()
export class CloudinaryObjectStoreService extends ObjectStoreService {
  private readonly folder: string;
  private configured = false;

  constructor(private readonly config: ConfigService) {
    super();
    this.folder =
      config.get<string>('CLOUDINARY_BUSINESS_REQUEST_FOLDER') ??
      'business-request-documents';
  }

  upload(file: Express.Multer.File): Promise<StoredObject> {
    this.validateFile(file);
    this.ensureConfigured();
    return this.uploadBuffer(file.buffer, {
      folder: this.folder,
      resource_type: 'auto',
      access_mode: 'authenticated',
      unique_filename: true,
      overwrite: false,
    });
  }

  async update(
    fileId: string,
    file: Express.Multer.File,
  ): Promise<StoredObject> {
    this.validateFile(file);
    this.ensureConfigured();
    const existingAsset = await this.get(fileId);
    return this.uploadBuffer(file.buffer, {
      public_id: fileId,
      resource_type: existingAsset.resourceType === 'raw' ? 'raw' : 'image',
      access_mode: 'authenticated',
      overwrite: true,
      invalidate: true,
    });
  }

  async get(fileId: string): Promise<StoredObject> {
    this.validateFileId(fileId);
    this.ensureConfigured();
    try {
      const asset = await cloudinary.api.resource(fileId, {
        resource_type: 'image',
      });
      if (!this.isInManagedFolder(asset.public_id)) {
        throw new NotFoundException('Stored file was not found');
      }
      return this.toStoredObject(asset);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (this.isCloudinaryNotFound(error)) {
        throw new NotFoundException('Stored file was not found');
      }

      // PDF files are stored as raw resources by Cloudinary.
      try {
        const asset = await cloudinary.api.resource(fileId, {
          resource_type: 'raw',
        });
        if (!this.isInManagedFolder(asset.public_id)) {
          throw new NotFoundException('Stored file was not found');
        }
        return this.toStoredObject(asset);
      } catch (rawError) {
        if (rawError instanceof NotFoundException) throw rawError;
        if (this.isCloudinaryNotFound(rawError)) {
          throw new NotFoundException('Stored file was not found');
        }
        throw new InternalServerErrorException(
          'Could not retrieve the uploaded file',
        );
      }
    }
  }

  async delete(fileId: string): Promise<void> {
    const asset = await this.get(fileId);
    try {
      const result = await cloudinary.uploader.destroy(fileId, {
        resource_type: asset.resourceType,
        invalidate: true,
      });
      if (result.result !== 'ok' && result.result !== 'not found') {
        throw new InternalServerErrorException('Could not delete the file');
      }
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (error instanceof InternalServerErrorException) throw error;
      throw new InternalServerErrorException('Could not delete the file');
    }
  }

  getFolder(): string {
    return this.folder;
  }

  private ensureConfigured(): void {
    if (this.configured) return;
    const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.config.get<string>('CLOUDINARY_API_SECRET');
    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException(
        'Cloudinary object storage is not configured',
      );
    }
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
    this.configured = true;
  }

  private uploadBuffer(
    buffer: Buffer,
    options: UploadApiOptions,
  ): Promise<StoredObject> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        options,
        (error, result) => {
          if (error || !result) {
            reject(new InternalServerErrorException('File upload failed'));
            return;
          }
          resolve(this.toStoredObject(result));
        },
      );
      const source = streamifier.createReadStream(buffer);
      const failUpload = () =>
        reject(new InternalServerErrorException('File upload failed'));
      source.on('error', failUpload);
      uploadStream.on('error', failUpload);
      source.pipe(uploadStream);
    });
  }

  private toStoredObject(asset: UploadApiResponse): StoredObject {
    return {
      fileId: asset.public_id,
      url: asset.secure_url,
      resourceType: asset.resource_type,
      format: asset.format ?? null,
    };
  }

  private validateFile(file: Express.Multer.File): void {
    if (!file?.buffer?.length) {
      throw new BadRequestException('A document file is required');
    }
    const matchesDeclaredType =
      (file.mimetype === 'image/jpeg' &&
        file.buffer[0] === 0xff &&
        file.buffer[1] === 0xd8 &&
        file.buffer[2] === 0xff) ||
      (file.mimetype === 'image/png' &&
        file.buffer
          .subarray(0, 8)
          .equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          )) ||
      (file.mimetype === 'application/pdf' &&
        file.buffer.subarray(0, 5).toString('ascii') === '%PDF-');
    if (!matchesDeclaredType) {
      throw new BadRequestException(
        'Only JPEG, PNG, and PDF files are accepted',
      );
    }
    if (file.buffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException('Files must be 10 MB or smaller');
    }
  }

  private validateFileId(fileId: string): void {
    if (!fileId || !this.isInManagedFolder(fileId)) {
      throw new NotFoundException('Stored file was not found');
    }
  }

  private isInManagedFolder(fileId: string): boolean {
    return fileId.startsWith(`${this.folder}/`);
  }

  private isCloudinaryNotFound(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'http_code' in error &&
      error.http_code === 404
    );
  }
}
