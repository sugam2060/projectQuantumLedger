import { Injectable, Logger } from '@nestjs/common';
import { AuditLogsService, type AuditRequestContext } from '../audit-logs';
import type { BusinessDocuments } from '../database/schemas/business/businesses';
import { ObjectStoreService, type StoredObject } from '../storage';
import { BusinessRequestsRepository } from './business-requests.repository';
import type { BusinessRequestDto } from './dto/business-request.dto';
import type { BusinessRequestUploads } from './types';

/**
 * Public business enquiry: stores the documents and the request for platform
 * review. It never creates a business or grants access.
 */
@Injectable()
export class BusinessRequestsService {
  private readonly logger = new Logger(BusinessRequestsService.name);

  constructor(
    private readonly repository: BusinessRequestsRepository,
    private readonly objectStore: ObjectStoreService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async submitBusinessRequest(
    request: BusinessRequestDto,
    files: BusinessRequestUploads,
    auditContext: AuditRequestContext = {},
  ): Promise<void> {
    const uploaded: StoredObject[] = [];
    try {
      const frontImage = await this.objectStore.upload(files.panCardFront);
      uploaded.push(frontImage);
      const backImage = await this.objectStore.upload(files.panCardBack);
      uploaded.push(backImage);
      const registrationCertificate = await this.objectStore.upload(
        files.businessRegistrationCertificate,
      );
      uploaded.push(registrationCertificate);

      const documents: BusinessDocuments = {
        panCard: {
          frontImage: {
            fileId: frontImage.fileId,
            url: frontImage.url,
          },
          backImage: {
            fileId: backImage.fileId,
            url: backImage.url,
          },
        },
        businessRegistrationCertificate: {
          fileId: registrationCertificate.fileId,
          url: registrationCertificate.url,
        },
      };

      await this.repository.insert({
        legalName: request.legalName.trim(),
        displayName: request.displayName.trim(),
        documents,
        address: {
          country: request.country.trim().toUpperCase(),
          city: request.city.trim(),
          postalCode: request.postalCode.trim(),
          addressLine1: request.addressLine1.trim(),
          addressLine2: request.addressLine2?.trim() || null,
        },
        primaryContactName: request.primaryContactName.trim(),
        primaryContactEmail: request.primaryContactEmail.trim().toLowerCase(),
        primaryContactPhone: request.primaryContactPhone.trim(),
      });
      await this.auditLogs.logUserEvent(
        {},
        {
          ...auditContext,
          eventType: 'PUBLIC_BUSINESS_REQUEST_SUBMITTED',
          responseStatus: 201,
          metadata: {},
        },
      );
    } catch (error) {
      const cleanupResults = await Promise.allSettled(
        uploaded.map((asset) => this.objectStore.delete(asset.fileId)),
      );
      if (cleanupResults.some((result) => result.status === 'rejected')) {
        this.logger.warn(
          'Failed to clean up one or more uploaded request files',
        );
      }
      throw error;
    }
  }
}
