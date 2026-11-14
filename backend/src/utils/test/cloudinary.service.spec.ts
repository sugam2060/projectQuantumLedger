import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { PassThrough } from 'stream';
import { CloudinaryObjectStoreService } from '../cloudinary.service';

describe('CloudinaryObjectStoreService', () => {
  let service: CloudinaryObjectStoreService;

  beforeEach(() => {
    jest.restoreAllMocks();
    const values: Record<string, string> = {
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: 'test-key',
      CLOUDINARY_API_SECRET: 'test-secret',
      CLOUDINARY_BUSINESS_REQUEST_FOLDER: 'business-request-documents',
    };
    const config = {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn((key: string) => values[key]),
    };
    service = new CloudinaryObjectStoreService(
      config as never as ConfigService,
    );
  });

  it('rejects a file whose bytes do not match an allowed document type', () => {
    const file = {
      buffer: Buffer.from('not really a pdf'),
      mimetype: 'application/pdf',
    };

    expect(() => service.upload(file as Express.Multer.File)).toThrow(
      BadRequestException,
    );
  });

  it('rejects files larger than 10 MB before upload', () => {
    const file = {
      buffer: Buffer.concat([
        Buffer.from('%PDF-'),
        Buffer.alloc(10 * 1024 * 1024),
      ]),
      mimetype: 'application/pdf',
    };

    expect(() => service.upload(file as Express.Multer.File)).toThrow(
      'Files must be 10 MB or smaller',
    );
  });

  it('limits object storage operations to its configured folder', async () => {
    await expect(service.get('another-folder/private-file')).rejects.toThrow(
      'Stored file was not found',
    );
  });

  it('uploads buffers through a stream and returns the Cloudinary asset reference', async () => {
    const uploadResult = {
      public_id: 'business-request-documents/uploaded-file',
      secure_url: 'https://cdn.example/uploaded-file.pdf',
      resource_type: 'image',
      format: 'pdf',
    } as UploadApiResponse;
    const stream = new PassThrough();
    const upload = jest
      .spyOn(cloudinary.uploader, 'upload_stream')
      .mockImplementation((options, callback) => {
        expect(options?.folder).toBe('business-request-documents');
        expect(options?.access_mode).toBe('authenticated');
        queueMicrotask(() => callback?.(undefined, uploadResult));
        return stream;
      });
    const file = {
      buffer: Buffer.from('%PDF-valid'),
      mimetype: 'application/pdf',
    };

    await expect(service.upload(file as Express.Multer.File)).resolves.toEqual({
      fileId: uploadResult.public_id,
      url: uploadResult.secure_url,
      resourceType: uploadResult.resource_type,
      format: uploadResult.format,
    });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('updates an existing managed asset in place', async () => {
    const existing = {
      public_id: 'business-request-documents/existing-file',
      secure_url: 'https://cdn.example/existing-file.pdf',
      resource_type: 'raw',
      format: 'pdf',
    } as UploadApiResponse;
    jest.spyOn(cloudinary.api, 'resource').mockResolvedValue(existing as never);
    const uploadResult = {
      ...existing,
      secure_url: 'https://cdn.example/updated-file.pdf',
    } as UploadApiResponse;
    const stream = new PassThrough();
    const upload = jest
      .spyOn(cloudinary.uploader, 'upload_stream')
      .mockImplementation((options, callback) => {
        expect(options?.public_id).toBe(existing.public_id);
        expect(options?.resource_type).toBe('raw');
        expect(options?.overwrite).toBe(true);
        expect(options?.access_mode).toBe('authenticated');
        queueMicrotask(() => callback?.(undefined, uploadResult));
        return stream;
      });

    await expect(
      service.update(existing.public_id, {
        buffer: Buffer.from('%PDF-replacement'),
        mimetype: 'application/pdf',
      } as Express.Multer.File),
    ).resolves.toMatchObject({
      fileId: existing.public_id,
      url: 'https://cdn.example/updated-file.pdf',
    });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('deletes an existing managed asset from Cloudinary', async () => {
    jest.spyOn(cloudinary.api, 'resource').mockResolvedValue({
      public_id: 'business-request-documents/delete-me',
      secure_url: 'https://cdn.example/delete-me.jpg',
      resource_type: 'image',
      format: 'jpg',
    } as never);
    const destroy = jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'ok' } as never);

    await expect(
      service.delete('business-request-documents/delete-me'),
    ).resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalledWith(
      'business-request-documents/delete-me',
      { resource_type: 'image', invalidate: true },
    );
  });
});
