import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { businessProvisioningRequests } from '../database/schema';
import type { BusinessDocuments } from '../database/schema/Identity_and_tenent/businesses';
import { ObjectStoreService } from '../utils/objectStore.service';
import type { StoredObject } from '../utils/objectStore.service';
import type { BusinessRequestDto } from './dto/business-request.dto';

@Injectable()
export class PlatformBusinessService {
  private readonly logger = new Logger(PlatformBusinessService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly objectStore: ObjectStoreService,
  ) {}

  async submitBusinessRequest(
    request: BusinessRequestDto,
    files: {
      panCardFront: Express.Multer.File;
      panCardBack: Express.Multer.File;
      businessRegistrationCertificate: Express.Multer.File;
    },
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

      await this.database.transactionWithSession({}, async (tx) => {
        await tx.insert(businessProvisioningRequests).values({
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
      });
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
