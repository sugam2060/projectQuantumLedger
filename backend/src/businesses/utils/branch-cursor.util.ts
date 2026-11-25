import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { BranchCursor, BranchCursorContext } from '../types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Hash of the filters, so a cursor cannot be replayed under different filters. */
function branchCursorScope(context: BranchCursorContext): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        businessId: context.businessId,
        from: context.from?.toISOString() ?? null,
        to: context.to?.toISOString() ?? null,
        branchId: context.branchId,
      }),
    )
    .digest('hex');
}

/** Encodes an opaque base64url keyset cursor bound to the list filters. */
export function createBranchCursor(
  cursor: BranchCursor,
  context: BranchCursorContext,
): string {
  const payload = {
    version: 1,
    createdAt: cursor.createdAt.toISOString(),
    id: cursor.id,
    scope: branchCursorScope(context),
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/** Decodes a cursor; throws 400 when it is malformed or was made for other filters. */
export function parseBranchCursor(
  value: string,
  context: BranchCursorContext,
): BranchCursor {
  try {
    const payload = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as {
      version?: unknown;
      createdAt?: unknown;
      id?: unknown;
      scope?: unknown;
    };
    if (
      payload.version !== 1 ||
      typeof payload.createdAt !== 'string' ||
      typeof payload.id !== 'string' ||
      !UUID_PATTERN.test(payload.id) ||
      payload.scope !== branchCursorScope(context)
    ) {
      throw new Error('Invalid cursor payload');
    }
    const createdAt = new Date(payload.createdAt);
    if (
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== payload.createdAt
    ) {
      throw new Error('Invalid cursor timestamp');
    }
    return { createdAt, id: payload.id };
  } catch {
    throw new BadRequestException(
      'Invalid or out-of-scope branch pagination cursor',
    );
  }
}
