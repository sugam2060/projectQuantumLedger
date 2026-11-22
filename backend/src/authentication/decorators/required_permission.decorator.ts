import { SetMetadata } from '@nestjs/common';

export const REQUIRED_ROLES = 'required_roles';
export const REQUIRE_CONFIGURED_ROLES = 'require_configured_roles';

/**
 * Marks an endpoint for business-specific role configuration.
 * The key identifies the endpoint; allowed role IDs are stored in the database.
 */
export const RequiredRoles = (endpointKey: string) =>
  SetMetadata(REQUIRED_ROLES, endpointKey);

/** Denies access when the endpoint has no configured role assignments. */
export const RequireConfiguredRoles = () =>
  SetMetadata(REQUIRE_CONFIGURED_ROLES, true);
