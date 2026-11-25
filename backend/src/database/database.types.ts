/**
 * Who a database transaction runs for. DatabaseService writes these ids as
 * transaction-local settings (app.user_id, ...) that RLS policies read through
 * the app.current_*() functions. Policies derive memberships and platform status
 * from the database; nothing here is trusted as a privilege by itself.
 */
export type RequestSession = {
  userId?: string;
  businessId?: string;
  branchId?: string;
  platformUserId?: string;
  /** Informational for callers; the database never trusts it. */
  isPlatform?: boolean;
  /** Informational for callers; the database never trusts it. */
  isOwner?: boolean;
};
