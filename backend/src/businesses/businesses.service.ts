import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditLogsService, type AuditRequestContext } from '../audit-logs';
import type { RequestSession } from '../database/database.types';
import type { business, BusinessDocuments } from '../database/schemas';
import { ObjectStoreService } from '../storage';
import { BusinessUpdateIdempotencyService } from './business-update-idempotency.service';
import { BusinessesRepository } from './businesses.repository';
import type { UpdateBusinessDto } from './dto/update-business.dto';
import type {
  BusinessAddress,
  BusinessUpdateFiles,
  StagedBusinessDocument,
} from './types';
import {
  getIncomingFiles,
  hasCompleteDocuments,
  normalizeBusinessUpdate,
  replacedFileIds,
} from './utils/business-update.util';

const ADDRESS_KEYS = [
  'country',
  'city',
  'postalCode',
  'addressLine1',
  'addressLine2',
] as const;

/** Business profile read and owner-only profile update. */
@Injectable()
export class BusinessesService {
  private readonly logger = new Logger(BusinessesService.name);

  constructor(
    private readonly repository: BusinessesRepository,
    private readonly idempotency: BusinessUpdateIdempotencyService,
    private readonly objectStore: ObjectStoreService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async getBusinessProfile(businessId: string, session: RequestSession) {
    const profile = await this.repository.inSession(session, (tx) =>
      this.repository.findProfile(tx, businessId),
    );

    if (!profile) throw new NotFoundException('Business was not found');
    return profile;
  }

  async updateBusinessProfile(
    businessId: string,
    session: RequestSession,
    dto: UpdateBusinessDto,
    files: BusinessUpdateFiles | undefined,
    idempotencyKey: string,
    auditContext: AuditRequestContext = {},
  ) {
    if (
      !session.userId ||
      session.isOwner !== true ||
      session.businessId !== businessId
    ) {
      throw new ForbiddenException('Business owner access required');
    }
    const userId = session.userId;

    const input = normalizeBusinessUpdate(dto);
    const incomingFiles = getIncomingFiles(files);
    if (Object.keys(input.fields).length === 0 && incomingFiles.length === 0) {
      throw new UnprocessableEntityException(
        'At least one permitted profile field or document is required',
      );
    }

    const idempotencyState = await this.idempotency.begin(
      userId,
      businessId,
      idempotencyKey,
      input.fields,
      dto.reason,
      incomingFiles.map(({ path, file }) => ({
        path,
        originalName: file.originalname,
        mimeType: file.mimetype,
        content: file.buffer,
      })),
    );
    if (idempotencyState.kind === 'replay') return idempotencyState.response;

    const staged: StagedBusinessDocument[] = [];
    let committed = false;
    try {
      for (const incoming of incomingFiles) {
        staged.push({
          path: incoming.path,
          object: await this.objectStore.upload(incoming.file),
        });
      }

      const result = await this.repository.inSession(session, async (tx) => {
        const ownerMembership =
          await this.repository.findActiveOwnerMembershipId(
            tx,
            businessId,
            userId,
          );
        if (!ownerMembership) {
          throw new ForbiddenException(
            'Only the active business owner can update business details',
          );
        }

        const current = await this.repository.lockBusiness(tx, businessId);
        if (!current) throw new NotFoundException('Business was not found');

        const patch: Partial<typeof business.$inferInsert> = {};
        const changedFields: Record<string, unknown> = {};
        const oldValues: Record<string, unknown> = {};
        const newValues: Record<string, unknown> = {};
        const setChange = (
          key: string,
          oldValue: unknown,
          newValue: unknown,
        ) => {
          if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return;
          changedFields[key] = newValue;
          oldValues[key] = oldValue;
          newValues[key] = newValue;
        };

        if (input.fields.displayName !== undefined) {
          setChange(
            'displayName',
            current.displayName,
            input.fields.displayName,
          );
          if (changedFields.displayName !== undefined) {
            patch.displayName = input.fields.displayName;
          }
        }
        if (input.fields.primaryContactNumber !== undefined) {
          setChange(
            'primaryContactNumber',
            current.primaryContactNumber,
            input.fields.primaryContactNumber,
          );
          if (changedFields.primaryContactNumber !== undefined) {
            patch.primaryContactNumber = input.fields.primaryContactNumber;
          }
        }
        if (input.fields.primaryContactEmail !== undefined) {
          setChange(
            'primaryContactEmail',
            current.primaryContactEmail,
            input.fields.primaryContactEmail,
          );
          if (changedFields.primaryContactEmail !== undefined) {
            patch.primaryContactEmail = input.fields.primaryContactEmail;
          }
        }

        const addressRequested = ADDRESS_KEYS.some(
          (key) => input.fields[key] !== undefined,
        );
        if (addressRequested) {
          if (!current.addressDetails) {
            throw new UnprocessableEntityException(
              'Business address is incomplete and cannot be partially updated',
            );
          }
          const addressDetails: BusinessAddress = {
            ...current.addressDetails,
            ...(input.fields.country !== undefined && {
              country: input.fields.country,
            }),
            ...(input.fields.city !== undefined && {
              city: input.fields.city,
            }),
            ...(input.fields.postalCode !== undefined && {
              postalCode: input.fields.postalCode,
            }),
            ...(input.fields.addressLine1 !== undefined && {
              addressLine1: input.fields.addressLine1,
            }),
            ...(input.fields.addressLine2 !== undefined && {
              addressLine2: input.fields.addressLine2 || null,
            }),
          };
          const address = [
            addressDetails.addressLine1,
            addressDetails.addressLine2,
          ]
            .filter((line): line is string => Boolean(line))
            .join(', ');
          setChange('addressDetails', current.addressDetails, addressDetails);
          setChange('address', current.address, address);
          if (
            changedFields.addressDetails !== undefined ||
            changedFields.address !== undefined
          ) {
            patch.addressDetails = addressDetails;
            patch.address = address;
          }
        }

        if (staged.length > 0) {
          const previousDocuments = current.documents;
          if (!hasCompleteDocuments(previousDocuments)) {
            throw new UnprocessableEntityException(
              'Business documents are incomplete and cannot be replaced',
            );
          }
          const documents: BusinessDocuments =
            structuredClone(previousDocuments);
          const changedDocumentNames: string[] = [];
          for (const item of staged) {
            const reference = {
              fileId: item.object.fileId,
              url: item.object.url,
            };
            if (item.path === 'panCard.frontImage') {
              documents.panCard.frontImage = reference;
            } else if (item.path === 'panCard.backImage') {
              documents.panCard.backImage = reference;
            } else {
              documents.businessRegistrationCertificate = reference;
            }
            changedDocumentNames.push(item.path);
          }
          patch.documents = documents;
          changedFields.documents = changedDocumentNames;
          oldValues.documents = changedDocumentNames;
          newValues.documents = changedDocumentNames;
        }

        let updatedAt = current.updatedAt;
        if (Object.keys(changedFields).length > 0) {
          const updated = await this.repository.updateBusiness(
            tx,
            businessId,
            patch,
          );
          if (!updated) throw new NotFoundException('Business was not found');
          updatedAt = updated.updatedAt;
          await this.auditLogs.insertUserEvent(tx, {
            ...auditContext,
            eventType: 'BUSINESS_PROFILE_UPDATED',
            userId,
            businessId,
            responseStatus: 200,
            metadata: {
              reason: dto.reason,
              oldValues,
              newValues,
              changedFields: Object.keys(changedFields),
            },
          });
        }

        const response = {
          businessId,
          updatedAt: updatedAt.toISOString(),
          changedFields,
        };
        return { response, previousDocuments: current.documents };
      });
      committed = true;

      const oldFileIds = replacedFileIds(result.previousDocuments, staged);
      const deletionResults = await Promise.allSettled(
        oldFileIds.map((fileId) => this.objectStore.delete(fileId)),
      );
      if (deletionResults.some((deletion) => deletion.status === 'rejected')) {
        this.logger.warn(
          'Failed to delete one or more replaced business documents',
        );
      }

      await this.idempotency.complete(idempotencyState, result.response);
      return result.response;
    } catch (error) {
      if (!committed) {
        const cleanupResults = await Promise.allSettled(
          staged.map((item) => this.objectStore.delete(item.object.fileId)),
        );
        if (cleanupResults.some((cleanup) => cleanup.status === 'rejected')) {
          this.logger.warn('Failed to clean up staged business documents');
        }
      }
      throw error;
    } finally {
      await this.idempotency.release(idempotencyState);
    }
  }
}
