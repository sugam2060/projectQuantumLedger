import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { RedisService } from '../redis/redis.service';
import { business, type BusinessDocuments } from '../database/schema';
import type { UpdateBusinessDto } from './dto/update-business.dto';

const OPERATION = 'businesses.update';
const RESULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const LOCK_TTL_SECONDS = 5 * 60;

export interface BusinessUpdateResponse {
  businessId: string;
  updatedAt: string;
  changedFields: Record<string, unknown>;
}

export interface BusinessUpdateFiles {
  panCardFront?: Express.Multer.File[];
  panCardBack?: Express.Multer.File[];
  businessRegistrationCertificate?: Express.Multer.File[];
}

export interface BusinessUpdateFields {
  displayName?: string;
  country?: string;
  city?: string;
  postalCode?: string;
  addressLine1?: string;
  addressLine2?: string;
  primaryContactNumber?: string;
  primaryContactEmail?: string;
}

export interface IncomingBusinessUpdateFile {
  path:
    | 'panCard.frontImage'
    | 'panCard.backImage'
    | 'businessRegistrationCertificate';
  file: Express.Multer.File;
}

export interface StagedBusinessDocument {
  path: IncomingBusinessUpdateFile['path'];
  object: {
    fileId: string;
    url: string;
    resourceType: string;
    format: string | null;
  };
}

export interface BusinessIdempotencyFile {
  path: string;
  originalName: string;
  mimeType: string;
  content: Buffer;
}

export interface BusinessIdempotencyContext {
  kind: 'reserved';
  redisKey: string;
  requestHash: string;
  reservation: string;
}

export interface BusinessIdempotencyReplay {
  kind: 'replay';
  response: BusinessUpdateResponse;
}

export type BusinessIdempotencyState =
  BusinessIdempotencyContext | BusinessIdempotencyReplay;

export type BusinessAddress = NonNullable<
  typeof business.$inferSelect.addressDetails
>;

@Injectable()
export class BusinessUtilsService {
  private readonly logger = new Logger(BusinessUtilsService.name);

  constructor(private readonly redis: RedisService) {}

  normalizeInput(dto: UpdateBusinessDto): { fields: BusinessUpdateFields } {
    const fields: BusinessUpdateFields = {};
    for (const key of [
      'displayName',
      'country',
      'city',
      'postalCode',
      'addressLine1',
      'addressLine2',
      'primaryContactNumber',
      'primaryContactEmail',
    ] as const) {
      const value = dto[key];
      if (value !== undefined) fields[key] = value;
    }
    if (fields.country !== undefined)
      fields.country = fields.country.toUpperCase();
    if (fields.primaryContactEmail !== undefined) {
      fields.primaryContactEmail = fields.primaryContactEmail.toLowerCase();
    }
    return { fields };
  }

  getIncomingFiles(
    files: BusinessUpdateFiles | undefined,
  ): IncomingBusinessUpdateFile[] {
    const entries = [
      ['panCard.frontImage', files?.panCardFront?.[0]],
      ['panCard.backImage', files?.panCardBack?.[0]],
      [
        'businessRegistrationCertificate',
        files?.businessRegistrationCertificate?.[0],
      ],
    ] as const;
    return entries.flatMap(([path, file]) => (file ? [{ path, file }] : []));
  }

  replacedFileIds(
    documents: BusinessDocuments | null,
    staged: StagedBusinessDocument[],
  ): string[] {
    if (!documents) return [];
    return staged.flatMap(({ path }) => {
      const oldReference =
        path === 'panCard.frontImage'
          ? documents.panCard.frontImage
          : path === 'panCard.backImage'
            ? documents.panCard.backImage
            : documents.businessRegistrationCertificate;
      return oldReference?.fileId ? [oldReference.fileId] : [];
    });
  }

  hasCompleteDocuments(
    documents: BusinessDocuments | null,
  ): documents is BusinessDocuments {
    return Boolean(
      documents?.panCard?.frontImage?.fileId &&
      documents.panCard.frontImage.url &&
      documents.panCard.backImage?.fileId &&
      documents.panCard.backImage.url &&
      documents.businessRegistrationCertificate?.fileId &&
      documents.businessRegistrationCertificate.url,
    );
  }

  async begin(
    userId: string,
    businessId: string,
    idempotencyKey: string,
    fields: BusinessUpdateFields,
    reason: string,
    files: BusinessIdempotencyFile[],
  ): Promise<BusinessIdempotencyState> {
    const fileHashes = files.map(
      ({ path, originalName, mimeType, content }) => ({
        path,
        originalName,
        mimeType,
        contentHash: createHash('sha256').update(content).digest('hex'),
      }),
    );
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ fields, reason, files: fileHashes }))
      .digest('hex');
    const keyHash = createHash('sha256').update(idempotencyKey).digest('hex');
    const redisKey = `idempotency:${userId}:${OPERATION}:${businessId}:${keyHash}`;

    const cached = await this.readResult(redisKey, requestHash);
    if (cached) return { kind: 'replay', response: cached };

    const reservation = JSON.stringify({ requestHash, owner: randomUUID() });
    let reserved: boolean;
    try {
      reserved = await this.redis.setIfAbsent(
        `${redisKey}:lock`,
        reservation,
        LOCK_TTL_SECONDS,
      );
    } catch {
      throw new ServiceUnavailableException(
        'Idempotency service is unavailable',
      );
    }
    if (!reserved) {
      const replay = await this.readResult(redisKey, requestHash);
      if (replay) return { kind: 'replay', response: replay };
      throw new ConflictException(
        'A request with this Idempotency-Key is in progress',
      );
    }

    return { kind: 'reserved', redisKey, requestHash, reservation };
  }

  async complete(
    context: BusinessIdempotencyContext,
    response: BusinessUpdateResponse,
  ): Promise<void> {
    try {
      await this.redis.set(
        `${context.redisKey}:result`,
        JSON.stringify({ requestHash: context.requestHash, response }),
        RESULT_TTL_SECONDS,
      );
    } catch {
      this.logger.warn(
        'Business update committed but idempotency result could not be cached',
      );
    }
  }

  async release(context: BusinessIdempotencyContext): Promise<void> {
    try {
      await this.redis.compareAndDelete(
        `${context.redisKey}:lock`,
        context.reservation,
      );
    } catch {
      this.logger.warn('Could not release business update idempotency lock');
    }
  }

  private async readResult(
    redisKey: string,
    requestHash: string,
  ): Promise<BusinessUpdateResponse | null> {
    let value: string | null;
    try {
      value = await this.redis.get(`${redisKey}:result`);
    } catch {
      throw new ServiceUnavailableException(
        'Idempotency service is unavailable',
      );
    }
    if (!value) return null;

    const entry = JSON.parse(value) as {
      requestHash: string;
      response: BusinessUpdateResponse;
    };
    if (entry.requestHash !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key was already used with a different request',
      );
    }
    return entry.response;
  }
}
