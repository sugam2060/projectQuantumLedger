import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuditLogsService, type AuditRequestContext } from '../audit-logs';
import {
  PG_UNIQUE_VIOLATION,
  postgresErrorCode,
} from '../common/utils/postgres-error.util';
import { RedisService } from '../redis/redis.service';
import type { MailJob } from '../workers/mail/mail.types';
import type { CreateBusinessBranchDto } from './dto/create-business-branch.dto';
import type { ProvisionBusinessDto } from './dto/provision-business.dto';
import { MailOutboxPublisher } from './mail-outbox.publisher';
import { PlatformBusinessesRepository } from './platform-businesses.repository';

const PROVISION_OPERATION = 'platform.businesses.create';
const CREATE_BRANCH_OPERATION = 'platform.businesses.create_branch';
const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IDEMPOTENCY_TTL_SECONDS = IDEMPOTENCY_TTL_MS / 1000;
const IDEMPOTENCY_LOCK_TTL_SECONDS = 5 * 60;
const REDEMPTION_TTL_MS = 24 * 60 * 60 * 1000;

/** Platform-staff operations on businesses: read, list, provision, add branches. */
@Injectable()
export class PlatformBusinessesService {
  private readonly logger = new Logger(PlatformBusinessesService.name);

  constructor(
    private readonly repository: PlatformBusinessesRepository,
    private readonly redis: RedisService,
    private readonly auditLogs: AuditLogsService,
    private readonly outboxPublisher: MailOutboxPublisher,
  ) {}

  async getBusinessDetails(businessId: string, platformUserId: string) {
    return this.repository.inPlatformTransaction(platformUserId, async (tx) => {
      const businessRow = await this.repository.findBusiness(tx, businessId);
      if (!businessRow) {
        throw new NotFoundException('Business was not found');
      }

      const businessBranches = await this.repository.listBranches(
        tx,
        businessId,
      );
      const membershipRows = await this.repository.listMemberships(
        tx,
        businessId,
      );

      return {
        business: businessRow,
        branches: businessBranches,
        memberships: membershipRows,
      };
    });
  }

  async getBranchDetails(
    businessId: string,
    branchId: string,
    platformUserId: string,
  ) {
    return this.repository.inPlatformTransaction(platformUserId, async (tx) => {
      const branchRow = await this.repository.findBranch(
        tx,
        businessId,
        branchId,
      );
      if (!branchRow) {
        throw new NotFoundException('Branch was not found for this business');
      }

      const branchTerminals = await this.repository.listBranchTerminals(
        tx,
        businessId,
        branchId,
      );
      const activeEmployees = await this.repository.listActiveBranchEmployees(
        tx,
        businessId,
        branchId,
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

      return {
        branch: branchRow,
        activeEmployeeCount: activeEmployees.length,
        activeEmployees,
        terminalCount: terminalCounts.total,
        terminalCounts,
        terminals: branchTerminals,
      };
    });
  }

  async listBusinesses(
    pagination: { page: number; limit: number },
    platformUserId: string,
  ) {
    return this.repository.inPlatformTransaction(platformUserId, async (tx) => {
      const total = await this.repository.countBusinesses(tx);
      const rows = await this.repository.listBusinessesPage(tx, {
        limit: pagination.limit,
        offset: (pagination.page - 1) * pagination.limit,
      });

      return {
        data: rows,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total,
          totalPages: Math.ceil(total / pagination.limit),
        },
      };
    });
  }

  async createBranch(
    businessId: string,
    input: CreateBusinessBranchDto,
    idempotencyKey: string,
    platformUserId: string,
    auditContext: AuditRequestContext = {},
  ) {
    const name = input.name.trim();
    const code = input.code.trim().toUpperCase();
    const address = input.address?.trim() || null;
    const contactNumber = input.contactNumber?.trim() || null;
    const terminalNames = input.terminals?.length
      ? input.terminals.map((terminal) => terminal.name.trim())
      : ['Initial Terminal'];
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          businessId,
          name,
          code,
          address,
          contactNumber,
          terminalNames,
        }),
      )
      .digest('hex');
    const idempotencyKeyHash = createHash('sha256')
      .update(idempotencyKey)
      .digest('hex');
    const redisKey = `idempotency:${platformUserId}:${CREATE_BRANCH_OPERATION}:${idempotencyKeyHash}`;

    const cachedResponse = await this.readIdempotency(redisKey, requestHash);
    if (cachedResponse) return cachedResponse;

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

    try {
      const response = await this.repository.inPlatformTransaction(
        platformUserId,
        async (tx) => {
          const existingBusiness = await this.repository.findBusinessSummary(
            tx,
            businessId,
          );
          if (!existingBusiness) {
            throw new NotFoundException('Business was not found');
          }

          const branch = await this.repository.insertBranch(tx, {
            businessId,
            name,
            code,
            address,
            contactNumber,
          });
          if (!branch) throw new Error('Branch could not be created');

          const terminalValues = terminalNames.map((terminalName) => ({
            businessId,
            branchId: branch.id,
            name: terminalName,
            terminalCode: generateTerminalCode(),
            status: 'inactive',
          }));
          const createdTerminals = await this.repository.insertTerminals(
            tx,
            terminalValues,
          );
          if (createdTerminals.length !== terminalValues.length) {
            throw new Error('One or more terminals could not be created');
          }

          const owners = await this.repository.listActiveOwnerEmails(
            tx,
            businessId,
          );
          if (owners.length === 0) {
            throw new ConflictException(
              'Business has no active owner to notify about the branch',
            );
          }

          const now = new Date();
          for (const owner of owners) {
            const mailJob: MailJob = {
              id: randomUUID(),
              to: owner.email,
              subject: `New branch created for ${existingBusiness.displayName ?? 'your business'}`,
              template: 'branch-created',
              context: {
                businessName: existingBusiness.displayName ?? 'Your business',
                businessId,
                branchName: branch.name,
                branchId: branch.id,
                branchCode: code,
                address,
                contactNumber,
                terminals: createdTerminals.map(
                  ({ id, name, terminalCode }) => ({ id, name, terminalCode }),
                ),
                homeUrl: '#',
              },
              correlationId: branch.id,
              createdAt: now.toISOString(),
            };
            await this.repository.enqueueMail(tx, {
              businessId,
              payload: mailJob,
            });
          }

          const result = {
            branch: { id: branch.id, name: branch.name },
            terminals: createdTerminals,
          };
          await this.auditLogs.insertPlatformEvent(tx, {
            ...auditContext,
            platformUserId,
            businessId,
            action: 'branch.created',
            responseStatus: 201,
            metadata: {
              branchId: branch.id,
              terminalIds: createdTerminals.map((terminal) => terminal.id),
            },
          });
          return result;
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
          'Branch creation committed but its idempotency result could not be cached',
        );
      }
      return response;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (postgresErrorCode(error) === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(
          'A branch with this code already exists for the business',
        );
      }
      this.logger.error(
        `Failed to create branch for business ${businessId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'Branch creation is temporarily unavailable',
      );
    } finally {
      try {
        await this.redis.compareAndDelete(`${redisKey}:lock`, reservation);
      } catch {
        this.logger.warn('Could not release branch creation idempotency lock');
      }
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
      const response = await this.repository.inPlatformTransaction(
        platformUserId,
        async (tx) => {
          const request = await this.repository.lockProvisioningRequest(
            tx,
            requestId,
          );
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

          const existingBusiness = await this.repository.findBusinessIdByPan(
            tx,
            pan,
          );
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

          const createdBusiness = await this.repository.insertBusiness(tx, {
            legalName: request.legalName,
            displayName: request.displayName,
            pan,
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
          });
          if (!createdBusiness) {
            throw new Error('Business could not be created');
          }

          const branch = await this.repository.insertMainBranch(tx, {
            businessId: createdBusiness.id,
            name: 'Main Branch',
            code: 'MAIN',
            address: request.address.addressLine1,
            contactNumber: request.primaryContactPhone,
          });
          if (!branch) throw new Error('Initial branch could not be created');

          const terminal = await this.repository.insertInitialTerminal(tx, {
            businessId: createdBusiness.id,
            branchId: branch.id,
            name: 'Initial Terminal',
            terminalCode: generateTerminalCode(),
            status: 'inactive',
          });
          if (!terminal)
            throw new Error('Initial terminal could not be created');

          await this.repository.markRequestApproved(tx, {
            requestId,
            platformUserId,
            businessId: createdBusiness.id,
            at: now,
          });

          await this.repository.insertOwnerRedemption(tx, {
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
              panLastFour: pan.slice(-4),
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
              businessName: createdBusiness.displayName,
              businessId: createdBusiness.id,
              branchId: branch.id,
              terminalCode: terminal.terminalCode,
              homeUrl: '#',
            },
            correlationId: requestId,
            createdAt: now.toISOString(),
          };
          await this.repository.enqueueMail(tx, {
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
      if (postgresErrorCode(error) === PG_UNIQUE_VIOLATION) {
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

function generateTerminalCode(): string {
  return `POS-${randomBytes(8).toString('hex').toUpperCase()}`;
}
