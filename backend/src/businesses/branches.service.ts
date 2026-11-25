import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { RequestSession } from '../database/database.types';
import { BranchesRepository } from './branches.repository';
import type { ListBranchesQueryDto } from './dto/list-branches-query.dto';
import type { BranchCursorContext } from './types';
import {
  createBranchCursor,
  parseBranchCursor,
} from './utils/branch-cursor.util';

/** Branch reads for business members, limited to the member's branch scope. */
@Injectable()
export class BranchesService {
  private readonly logger = new Logger(BranchesService.name);

  constructor(private readonly repository: BranchesRepository) {}

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
    const userId = session.userId;

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
      return await this.repository.inSession(session, async (tx) => {
        const membership = await this.repository.findActiveMembership(
          tx,
          businessId,
          userId,
        );
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
          ? parseBranchCursor(query.cursor, cursorContext)
          : null;

        const rows = await this.repository.listPage(tx, {
          businessId,
          scopeBranchId,
          from,
          to,
          cursor,
          limit: query.limit,
        });

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
              ? createBranchCursor(
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
    const userId = session.userId;

    try {
      return await this.repository.inSession(session, async (tx) => {
        const membership = await this.repository.findActiveMembership(
          tx,
          businessId,
          userId,
        );
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

        const row = await this.repository.findBranch(tx, businessId, branchId);
        if (!row) throw new NotFoundException('Branch was not found');

        const terminalRows = await this.repository.countTerminalsByStatus(
          tx,
          businessId,
          branchId,
        );
        const memberRows = await this.repository.countMembersByActive(
          tx,
          businessId,
          branchId,
        );

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
}
