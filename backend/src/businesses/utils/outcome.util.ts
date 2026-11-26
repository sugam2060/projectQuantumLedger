import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PERMISSION_DENIED } from '../../authorization';

/** Outcomes returned by the app.* write functions (member, role, invitation). */
export type WriteOutcome =
  'ok' | 'not_found' | 'forbidden' | 'invalid' | 'conflict';

/**
 * Maps a SQL function outcome to the HTTP error. `ok` returns normally; an
 * unknown outcome is treated as forbidden (fail closed).
 */
export function assertOk(
  outcome: string | undefined,
  messages: Partial<Record<Exclude<WriteOutcome, 'ok'>, string>> = {},
): void {
  switch (outcome) {
    case 'ok':
      return;
    case 'not_found':
      throw new NotFoundException(messages.not_found ?? 'Not found');
    case 'invalid':
      throw new BadRequestException(messages.invalid ?? 'Invalid request');
    case 'conflict':
      throw new ConflictException(messages.conflict ?? 'Conflict');
    default:
      throw new ForbiddenException(messages.forbidden ?? PERMISSION_DENIED);
  }
}
