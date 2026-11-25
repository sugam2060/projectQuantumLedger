import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import type {
  NewSession,
  RotationOutcome,
  RotationResult,
  SessionActor,
} from './types';

type RotationRow = {
  outcome: RotationOutcome;
  session_id: string | null;
  user_id: string | null;
  platform_user_id: string | null;
  client_type: string | null;
  terminal_id: string | null;
  persistent: boolean | null;
  expires_at: string | Date | null;
};

const toDate = (value: string | Date | null): Date | null =>
  value === null ? null : value instanceof Date ? value : new Date(value);

/**
 * Refresh-token sessions. Every call goes through the app.auth_* SECURITY DEFINER
 * functions; the runtime role cannot write public.sessions directly.
 */
@Injectable()
export class SessionsRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Creates a session for the actor; runs with that actor as request context. */
  async create(actor: SessionActor, session: NewSession): Promise<string> {
    return this.database.transactionWithSession(actor, async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        SELECT app.auth_create_session(
          ${actor.userId ?? null}::uuid,
          ${actor.platformUserId ?? null}::uuid,
          ${session.tokenHash},
          ${session.clientType},
          ${session.terminalId}::uuid,
          ${session.persistent},
          ${session.userAgent},
          ${session.ip},
          ${session.expiresAt.toISOString()}::timestamptz
        ) AS id`);
      return result.rows[0].id;
    });
  }

  /** Atomically swaps `oldHash` for `newHash` (see app.auth_rotate_session). */
  async rotate(input: {
    oldHash: string;
    newHash: string;
    userAgent: string | null;
    ip: string | null;
    persistentTtlSeconds: number;
    sessionTtlSeconds: number;
  }): Promise<RotationResult> {
    return this.database.transactionWithSession({}, async (tx) => {
      const result = await tx.execute<RotationRow>(sql`
        SELECT * FROM app.auth_rotate_session(
          ${input.oldHash},
          ${input.newHash},
          ${input.userAgent},
          ${input.ip},
          make_interval(secs => ${input.persistentTtlSeconds}),
          make_interval(secs => ${input.sessionTtlSeconds})
        )`);
      const row = result.rows[0];
      return {
        outcome: row.outcome,
        sessionId: row.session_id,
        userId: row.user_id,
        platformUserId: row.platform_user_id,
        clientType: row.client_type,
        terminalId: row.terminal_id,
        persistent: row.persistent === true,
        expiresAt: toDate(row.expires_at),
      };
    });
  }

  /** Revokes one session by its token hash; false when nothing was active. */
  async revoke(tokenHash: string): Promise<boolean> {
    return this.database.transactionWithSession({}, async (tx) => {
      const result = await tx.execute<{ revoked: boolean }>(
        sql`SELECT app.auth_revoke_session(${tokenHash}) AS revoked`,
      );
      return result.rows[0].revoked === true;
    });
  }

  /** Revokes every active session of the actor; returns how many. */
  async revokeAll(actor: SessionActor): Promise<number> {
    return this.database.transactionWithSession(actor, async (tx) => {
      const result = await tx.execute<{ revoked: number }>(sql`
        SELECT app.auth_revoke_all_sessions(
          ${actor.userId ?? null}::uuid,
          ${actor.platformUserId ?? null}::uuid
        ) AS revoked`);
      return Number(result.rows[0].revoked);
    });
  }
}
