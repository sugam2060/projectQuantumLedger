import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull, or } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import {
  branches,
  business,
  businessMemberships,
  businessProvisioningRequests,
  mailOutbox,
  ownerRedemptions,
  roles,
  terminals,
  users,
} from '../database/schema';
import type { BusinessDocuments } from '../database/schema/Identity_and_tenent/businesses';
import { ObjectStoreService } from '../utils/objectStore.service';
import type { StoredObject } from '../utils/objectStore.service';
import type { BusinessRequestDto } from './dto/business-request.dto';
import type { ProvisionBusinessDto } from './dto/provision-business.dto';
import type { MailJob } from '../workers/mail/mail.types';
import { RedisService } from '../redis/redis.service';
import { MailOutboxPublisher } from './mail-outbox.publisher';
import {
  AuditLogService,
  type AuditRequestContext,
} from '../database/audit-log.service';

const PROVISION_OPERATION = 'platform.businesses.create';
const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IDEMPOTENCY_TTL_SECONDS = IDEMPOTENCY_TTL_MS / 1000;
const IDEMPOTENCY_LOCK_TTL_SECONDS = 5 * 60;
const REDEMPTION_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PlatformBusinessService {
  private readonly logger = new Logger(PlatformBusinessService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly objectStore: ObjectStoreService,
    private readonly redis: RedisService,
    private readonly auditLogs: AuditLogService,
    private readonly outboxPublisher: MailOutboxPublisher,
  ) {}

  async getBusinessDetails(
    businessId: string,
    platformUserId: string,
    auditContext: AuditRequestContext = {},
  ) {
    return this.database.transactionWithSession(
      { isPlatform: true, platformUserId },
      async (tx) => {
        const [businessRow] = await tx
          .select()
          .from(business)
          .where(eq(business.id, businessId))
          .limit(1);
        if (!businessRow) {
          throw new NotFoundException('Business was not found');
        }

        const businessBranches = await tx
          .select()
          .from(branches)
          .where(eq(branches.businessId, businessId));

        const membershipRows = await tx
          .select({
            id: businessMemberships.id,
            isOwner: businessMemberships.isOwner,
            isActive: businessMemberships.isActive,
            branchId: businessMemberships.branchId,
            roleId: businessMemberships.roleId,
            createdAt: businessMemberships.createdAt,
            updatedAt: businessMemberships.updatedAt,
            user: {
              id: users.id,
              email: users.emailNormalized,
              name: users.name,
              status: users.status,
            },
            role: {
              id: roles.id,
              name: roles.name,
              description: roles.description,
              isSystem: roles.isSystem,
            },
            branch: {
              id: branches.id,
              name: branches.name,
              code: branches.code,
              isActive: branches.isActive,
            },
          })
          .from(businessMemberships)
          .leftJoin(users, eq(businessMemberships.userId, users.id))
          .leftJoin(roles, eq(businessMemberships.roleId, roles.id))
          .leftJoin(branches, eq(businessMemberships.branchId, branches.id))
          .where(eq(businessMemberships.businessId, businessId));

        await this.auditLogs.insertPlatformEvent(tx, {
          ...auditContext,
          platformUserId,
          businessId,
          action: 'business.details.viewed',
          responseStatus: 200,
          metadata: {
            branchCount: businessBranches.length,
            membershipCount: membershipRows.length,
          },
        });

        return {
          business: businessRow,
          branches: businessBranches,
          memberships: membershipRows,
        };
      },
    );
  }

  async getBranchDetails(
    businessId: string,
    branchId: string,
    platformUserId: string,
    auditContext: AuditRequestContext = {},
  ) {
    return this.database.transactionWithSession(
      { isPlatform: true, platformUserId },
      async (tx) => {
        const [branchRow] = await tx
          .select()
          .from(branches)
          .where(
            and(eq(branches.id, branchId), eq(branches.businessId, businessId)),
          )
          .limit(1);
        if (!branchRow) {
          throw new NotFoundException('Branch was not found for this business');
        }

        const branchTerminals = await tx
          .select()
          .from(terminals)
          .where(
            and(
              eq(terminals.businessId, businessId),
              eq(terminals.branchId, branchId),
            ),
          );

        const activeEmployees = await tx
          .select({
            membershipId: businessMemberships.id,
            isOwner: businessMemberships.isOwner,
            branchId: businessMemberships.branchId,
            createdAt: businessMemberships.createdAt,
            user: {
              id: users.id,
              email: users.emailNormalized,
              name: users.name,
              status: users.status,
            },
            role: {
              id: roles.id,
              name: roles.name,
              description: roles.description,
              isSystem: roles.isSystem,
            },
          })
          .from(businessMemberships)
          .leftJoin(users, eq(businessMemberships.userId, users.id))
          .leftJoin(roles, eq(businessMemberships.roleId, roles.id))
          .where(
            and(
              eq(businessMemberships.businessId, businessId),
              eq(businessMemberships.isActive, true),
              or(
                eq(businessMemberships.branchId, branchId),
                isNull(businessMemberships.branchId),
              ),
            ),
          );

        const terminalCounts = {
          total: branchTerminals.length,
          active: branchTerminals.filter(
            (terminal) => terminal.status === 'active',
          ).length,
          inactive: branchTerminals.filter(
            (terminal) => terminal.status === 'inactive',
          ).length,
          maintenance: branchTerminals.filter(
            (terminal) => terminal.status === 'maintenance',
          ).length,
        };

        await this.auditLogs.insertPlatformEvent(tx, {
          ...auditContext,
          platformUserId,
          businessId,
          action: 'business.branch.details.viewed',
          responseStatus: 200,
          metadata: {
            branchId,
            activeEmployeeCount: activeEmployees.length,
            terminalCount: terminalCounts.total,
          },
        });

        return {
          branch: branchRow,
          activeEmployeeCount: activeEmployees.length,
          activeEmployees,
          terminalCount: terminalCounts.total,
          terminalCounts,
          terminals: branchTerminals,
        };
      },
    );
  }

  async submitBusinessRequest(
    request: BusinessRequestDto,
    files: {
      panCardFront: Express.Multer.File;
      panCardBack: Express.Multer.File;
      businessRegistrationCertificate: Express.Multer.File;
    },
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

  async provisionBusiness(
    requestId: string,
    input: ProvisionBusinessDto,
    idempotencyKey: string,
    platformUserId: string,
    auditContext: AuditRequestContext = {},
  ) {
    const pan = input.pan.trim().toUpperCase();
    if (!pan) {
      throw new UnprocessableEntityException('A valid PAN is required');
    }
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          requestId,
          pan,
          ownerEmail: input.ownerEmail?.trim().toLowerCase() ?? null,
        }),
      )
      .digest('hex');
    const idempotencyKeyHash = createHash('sha256')
      .update(idempotencyKey)
      .digest('hex');
    const redisKey = `idempotency:${platformUserId}:${PROVISION_OPERATION}:${idempotencyKeyHash}`;
    const completedEntry = await this.readIdempotency(redisKey, requestHash);
    if (completedEntry) return completedEntry;
    const reservation = JSON.stringify({
      state: 'pending',
      requestHash,
      owner: randomUUID(),
    });
    let reserved: boolean;
    try {
      reserved = await this.redis.setIfAbsent(
        `${redisKey}:lock`,
        reservation,
        IDEMPOTENCY_LOCK_TTL_SECONDS,
      );
    } catch {
      throw new ServiceUnavailableException(
        'Idempotency service is unavailable',
      );
    }
    if (!reserved) {
      const replay = await this.readIdempotency(redisKey, requestHash);
      if (replay) return replay;
      throw new ConflictException(
        'A request with this Idempotency-Key is in progress',
      );
    }

    const redeemCode = randomBytes(12).toString('hex').toUpperCase();
    const tokenHash = createHash('sha256').update(redeemCode).digest('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + REDEMPTION_TTL_MS);

    try {
      const response = await this.database.transactionWithSession(
        { isPlatform: true, platformUserId },
        async (tx) => {
          const [request] = await tx
            .select()
            .from(businessProvisioningRequests)
            .where(eq(businessProvisioningRequests.id, requestId))
            .limit(1)
            .for('update');
          if (!request) {
            throw new NotFoundException('Business request was not found');
          }
          if (request.status !== 'pending' || request.provisionedBusinessId) {
            throw new ConflictException(
              'Business request is not available for provisioning',
            );
          }
          const address = request.address;
          const documents = request.documents;
          if (
            !request.legalName.trim() ||
            !request.displayName.trim() ||
            !request.primaryContactName.trim() ||
            !request.primaryContactEmail.trim() ||
            !request.primaryContactPhone.trim() ||
            !address?.country?.trim() ||
            !address.city?.trim() ||
            !address.postalCode?.trim() ||
            !address.addressLine1?.trim() ||
            !documents?.panCard?.frontImage?.fileId ||
            !documents.panCard.frontImage.url ||
            !documents.panCard.backImage?.fileId ||
            !documents.panCard.backImage.url ||
            !documents.businessRegistrationCertificate?.fileId ||
            !documents.businessRegistrationCertificate.url
          ) {
            throw new UnprocessableEntityException(
              'Business request profile is incomplete or invalid',
            );
          }

          const normalizedPan = pan;
          const [existingBusiness] = await tx
            .select({ id: business.id })
            .from(business)
            .where(eq(business.pan, normalizedPan))
            .limit(1);
          if (existingBusiness) {
            throw new ConflictException(
              'A business with this PAN is already registered',
            );
          }

          const ownerEmail =
            input.ownerEmail?.trim().toLowerCase() ??
            request.primaryContactEmail;
          if (!ownerEmail) {
            throw new UnprocessableEntityException(
              'An initial owner email is required',
            );
          }

          const [createdBusiness] = await tx
            .insert(business)
            .values({
              legalName: request.legalName,
              displayName: request.displayName,
              pan: normalizedPan,
              address: [
                request.address.addressLine1,
                request.address.addressLine2,
              ]
                .filter((line): line is string => Boolean(line))
                .join(', '),
              addressDetails: request.address,
              documents: request.documents,
              primaryContactNumber: request.primaryContactPhone,
              primaryContactEmail: request.primaryContactEmail,
              isActive: false,
              createdBy: platformUserId,
            })
            .returning({ id: business.id, displayName: business.displayName });
          if (!createdBusiness) {
            throw new Error('Business could not be created');
          }

          const [branch] = await tx
            .insert(branches)
            .values({
              businessId: createdBusiness.id,
              name: 'Main Branch',
              code: 'MAIN',
              address: request.address.addressLine1,
              contactNumber: request.primaryContactPhone,
            })
            .returning({ id: branches.id });
          if (!branch) throw new Error('Initial branch could not be created');

          const [terminal] = await tx
            .insert(terminals)
            .values({
              businessId: createdBusiness.id,
              branchId: branch.id,
              name: 'Initial Terminal',
              terminalCode: 'POS-01',
              status: 'active',
            })
            .returning({ id: terminals.id });
          if (!terminal)
            throw new Error('Initial terminal could not be created');

          await tx
            .update(businessProvisioningRequests)
            .set({
              status: 'approved',
              reviewedBy: platformUserId,
              reviewedAt: now,
              provisionedBusinessId: createdBusiness.id,
              updatedAt: now,
            })
            .where(eq(businessProvisioningRequests.id, requestId));

          await tx.insert(ownerRedemptions).values({
            businessId: createdBusiness.id,
            requestId,
            emailNormalized: ownerEmail,
            tokenHash,
            expiresAt,
            createdByPlatformUserId: platformUserId,
          });

          const response = {
            message: `Business ${createdBusiness.displayName} has been verified. Redeem code has been sent to owner.`,
            businessId: createdBusiness.id,
            ownerActivationInvitationStatus: 'queued',
          };
          await this.auditLogs.insertPlatformEvent(tx, {
            ...auditContext,
            platformUserId,
            businessId: createdBusiness.id,
            provisioningRequestId: requestId,
            action: 'business.provisioned',
            responseStatus: 201,
            metadata: {
              panLastFour: normalizedPan.slice(-4),
              initialBranchId: branch.id,
              initialTerminalId: terminal.id,
            },
          });

          const mailJob: MailJob = {
            id: randomUUID(),
            to: ownerEmail,
            subject: 'Complete your Fortis business owner registration',
            template: 'redeem-code',
            context: {
              redeemCode,
              expiresAt: expiresAt.toISOString(),
              homeUrl: '#',
            },
            correlationId: requestId,
            createdAt: now.toISOString(),
          };
          await tx.insert(mailOutbox).values({
            businessId: createdBusiness.id,
            requestId,
            payload: mailJob,
          });

          return response;
        },
      );
      this.outboxPublisher.notifyOutboxAvailable();
      try {
        await this.redis.set(
          `${redisKey}:result`,
          JSON.stringify({ requestHash, response }),
          IDEMPOTENCY_TTL_SECONDS,
        );
      } catch {
        this.logger.warn(
          'Provisioning committed but Redis idempotency result could not be cached',
        );
      }
      return response;
    } catch (error) {
      const errorCode = postgresErrorCode(error);
      if (errorCode === '23505') {
        throw new ConflictException(
          'Business request or PAN has already been provisioned',
        );
      }
      throw error;
    } finally {
      try {
        await this.redis.compareAndDelete(`${redisKey}:lock`, reservation);
      } catch {
        this.logger.warn('Could not release provisioning idempotency lock');
      }
    }
  }

  private async readIdempotency(redisKey: string, requestHash: string) {
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
      response: Record<string, unknown>;
    };
    if (entry.requestHash !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key was already used with a different request',
      );
    }
    return entry.response;
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if (
    'cause' in error &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'code' in error.cause &&
    typeof error.cause.code === 'string'
  ) {
    return error.cause.code;
  }
  return undefined;
}
