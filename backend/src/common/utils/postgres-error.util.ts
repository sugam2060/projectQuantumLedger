/** SQLSTATE for a unique-constraint violation. */
export const PG_UNIQUE_VIOLATION = '23505';
/** SQLSTATE raised when RLS or a GRANT refuses the statement. */
export const PG_INSUFFICIENT_PRIVILEGE = '42501';

/**
 * Returns the PostgreSQL SQLSTATE of an error thrown by `pg` or wrapped by Drizzle
 * (which puts the driver error in `cause`). `undefined` for anything else.
 */
export function postgresErrorCode(error: unknown): string | undefined {
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
