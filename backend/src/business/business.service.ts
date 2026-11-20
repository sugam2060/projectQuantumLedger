import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, count, desc, eq, gte, lt, lte, or } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import {
  business,
  businessMemberships,
  branches,
  terminals,
  type BusinessDocuments,
} from '../database/schema';
import type { RequestSession } from '../database/request_context.service';
import {
  AuditLogService,
  type AuditRequestContext,
} from '../database/audit-log.service';
import { ObjectStoreService } from '../utils/objectStore.service';
import type { UpdateBusinessDto } from './dto/update-business.dto';
import type { ListBranchesQueryDto } from './dto/list-branches-query.dto';
import {
  BusinessUtilsService,
  type BusinessAddress,
  type BranchCursorContext,
  type BusinessUpdateFiles,
  type StagedBusinessDocument,
} from './business.utils.service';

@Injectable()
export class BusinessService {
  private readonly logger = new Logger(BusinessService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly businessUtils: BusinessUtilsService,
    private readonly objectStore: ObjectStoreService,
    private readonly auditLogs: AuditLogService,
  ) {}

  async getBusinessProfile(businessId: string) {
    const [profile] = await this.database
      .select({
        id: business.id,
        legalName: business.legalName,
        displayName: business.displayName,
        address: business.address,
        addressDetails: business.addressDetails,
        primaryContactNumber: business.primaryContactNumber,
        primaryContactEmail: business.primaryContactEmail,
        isActive: business.isActive,
        createdAt: business.createdAt,
        updatedAt: business.updatedAt,
      })
      .from(business)
      .where(eq(business.id, businessId))
      .limit(1);

    if (!profile) throw new NotFoundException('Business was not found');
    return profile;
  }

  async listBranches(
    businessId: string,
    session: RequestSession,
    query: ListBranchesQueryDto,
  ) {
    if (
      !session.userId ||
      session.isPlatform === true ||
      session.businessId !== businessId
    ) {
      throw new ForbiddenException('Business branch access required');
    }

    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    if (
      (from && Number.isNaN(from.getTime())) ||
      (to && Number.isNaN(to.getTime())) ||
      (from && to && from.getTime() > to.getTime())
    ) {
      throw new BadRequestException('Invalid branch creation time range');
    }

    try {
      return await this.database.transactionWithSession(session, async (tx) => {
        const [membership] = await tx
          .select({
            branchId: businessMemberships.branchId,
            isOwner: businessMemberships.isOwner,
          })
          .from(businessMemberships)
          .where(
            and(
              eq(businessMemberships.businessId, businessId),
              eq(businessMemberships.userId, session.userId!),
              eq(businessMemberships.isActive, true),
            ),
          )
          .limit(1);
        if (!membership || (session.isOwner === true && !membership.isOwner)) {
          throw new ForbiddenException('Active business membership required');
        }

        const scopeBranchId = membership.isOwner ? null : membership.branchId;
        const cursorContext: BranchCursorContext = {
          businessId,
          from,
          to,
          branchId: scopeBranchId,
        };
        const cursor = query.cursor
          ? this.businessUtils.parseBranchCursor(query.cursor, cursorContext)
          : null;

        const conditions = [eq(branches.businessId, businessId)];
        if (scopeBranchId) {
          conditions.push(eq(branches.id, scopeBranchId));
        }
        if (from) conditions.push(gte(branches.createdAt, from));
        if (to) conditions.push(lte(branches.createdAt, to));
        if (cursor) {
          conditions.push(
            or(
              lt(branches.createdAt, cursor.createdAt),
              and(
                eq(branches.createdAt, cursor.createdAt),
                lt(branches.id, cursor.id),
              ),
            )!,
          );
        }

        const rows = await tx
          .select({
            id: branches.id,
            name: branches.name,
            code: branches.code,
            address: branches.address,
            contactNumber: branches.contactNumber,
            isActive: branches.isActive,
            createdAt: branches.createdAt,
            updatedAt: branches.updatedAt,
          })
          .from(branches)
          .where(and(...conditions))
          .orderBy(desc(branches.createdAt), desc(branches.id))
          .limit(query.limit + 1);

        const hasNextPage = rows.length > query.limit;
        const pageRows = rows.slice(0, query.limit);
        const lastRow = pageRows[pageRows.length - 1];
        return {
          items: pageRows.map(({ isActive, ...branch }) => ({
            ...branch,
            status: isActive ? 'active' : 'inactive',
          })),
          nextCursor:
            hasNextPage && lastRow
              ? this.businessUtils.createBranchCursor(
                  { createdAt: lastRow.createdAt, id: lastRow.id },
                  cursorContext,
                )
              : null,
        };
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Failed to list branches for business ${businessId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'Branch list is temporarily unavailable',
      );
    }
  }

  async getBranchDetails(
    businessId: string,
    branchId: string,
    session: RequestSession,
  ) {
    if (
      !session.userId ||
      session.isPlatform === true ||
      session.businessId !== businessId
    ) {
      throw new ForbiddenException('Business branch access required');
    }

    try {
      return await this.database.transactionWithSession(session, async (tx) => {
        const [membership] = await tx
          .select({
            branchId: businessMemberships.branchId,
            isOwner: businessMemberships.isOwner,
          })
          .from(businessMemberships)
          .where(
            and(
              eq(businessMemberships.businessId, businessId),
              eq(businessMemberships.userId, session.userId!),
              eq(businessMemberships.isActive, true),
            ),
          )
          .limit(1);

        if (!membership || (session.isOwner === true && !membership.isOwner)) {
          throw new ForbiddenException('Active business membership required');
        }
        if (
          !membership.isOwner &&
          membership.branchId !== null &&
          membership.branchId !== branchId
        ) {
          throw new NotFoundException('Branch was not found');
        }

        const [row] = await tx
          .select({
            id: branches.id,
            businessId: branches.businessId,
            name: branches.name,
            code: branches.code,
            address: branches.address,
            contactNumber: branches.contactNumber,
            isActive: branches.isActive,
            createdAt: branches.createdAt,
            updatedAt: branches.updatedAt,
          })
          .from(branches)
          .where(
            and(eq(branches.businessId, businessId), eq(branches.id, branchId)),
          )
          .limit(1);

        if (!row) throw new NotFoundException('Branch was not found');

        const terminalRows = await tx
          .select({ status: terminals.status, total: count().mapWith(Number) })
          .from(terminals)
          .where(
            and(
              eq(terminals.businessId, businessId),
              eq(terminals.branchId, branchId),
            ),
          )
          .groupBy(terminals.status);
        const memberRows = await tx
          .select({
            isActive: businessMemberships.isActive,
            total: count().mapWith(Number),
          })
          .from(businessMemberships)
          .where(
            and(
              eq(businessMemberships.businessId, businessId),
              eq(businessMemberships.branchId, branchId),
            ),
          )
          .groupBy(businessMemberships.isActive);

        const terminalCounts = {
          active: 0,
          inactive: 0,
          maintenance: 0,
        };
        for (const terminal of terminalRows) {
          if (terminal.status in terminalCounts) {
            terminalCounts[terminal.status as keyof typeof terminalCounts] =
              terminal.total;
          }
        }
        const memberCounts = { active: 0, inactive: 0 };
        for (const member of memberRows) {
          memberCounts[member.isActive ? 'active' : 'inactive'] = member.total;
        }

        const { isActive, ...branch } = row;
        return {
          branch: {
            ...branch,
            status: isActive ? 'active' : 'inactive',
          },
          summary: {
            terminals: {
              ...terminalCounts,
              total: Object.values(terminalCounts).reduce(
                (total, value) => total + value,
                0,
              ),
            },
            members: {
              ...memberCounts,
              total: memberCounts.active + memberCounts.inactive,
            },
          },
        };
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Failed to read branch ${branchId} for business ${businessId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'Branch details are temporarily unavailable',
      );
    }
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

    const input = this.businessUtils.normalizeInput(dto);
    const incomingFiles = this.businessUtils.getIncomingFiles(files);
    if (Object.keys(input.fields).length === 0 && incomingFiles.length === 0) {
      throw new UnprocessableEntityException(
        'At least one permitted profile field or document is required',
      );
    }

    const idempotencyState = await this.businessUtils.begin(
      session.userId,
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

      const result = await this.database.transactionWithSession(
        session,
        async (tx) => {
          const [ownerMembership] = await tx
            .select({ id: businessMemberships.id })
            .from(businessMemberships)
            .where(
              and(
                eq(businessMemberships.businessId, businessId),
                eq(businessMemberships.userId, session.userId!),
                eq(businessMemberships.isOwner, true),
                eq(businessMemberships.isActive, true),
              ),
            )
            .limit(1);
          if (!ownerMembership) {
            throw new ForbiddenException(
              'Only the active business owner can update business details',
            );
          }

          const [current] = await tx
            .select()
            .from(business)
            .where(eq(business.id, businessId))
            .limit(1)
            .for('update');
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

          const addressKeys = [
            'country',
            'city',
            'postalCode',
            'addressLine1',
            'addressLine2',
          ] as const;
          const addressRequested = addressKeys.some(
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
            if (!this.businessUtils.hasCompleteDocuments(previousDocuments)) {
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
            const [updated] = await tx
              .update(business)
              .set({ ...patch, updatedAt: new Date() })
              .where(eq(business.id, businessId))
              .returning({ updatedAt: business.updatedAt });
            if (!updated) throw new NotFoundException('Business was not found');
            updatedAt = updated.updatedAt;
            await this.auditLogs.insertUserEvent(tx, {
              ...auditContext,
              eventType: 'BUSINESS_PROFILE_UPDATED',
              userId: session.userId,
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
        },
      );
      committed = true;

      const oldFileIds = this.businessUtils.replacedFileIds(
        result.previousDocuments,
        staged,
      );
      const deletionResults = await Promise.allSettled(
        oldFileIds.map((fileId) => this.objectStore.delete(fileId)),
      );
      if (deletionResults.some((deletion) => deletion.status === 'rejected')) {
        this.logger.warn(
          'Failed to delete one or more replaced business documents',
        );
      }

      await this.businessUtils.complete(idempotencyState, result.response);
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
      await this.businessUtils.release(idempotencyState);
    }
  }
}
