import { SetMetadata } from '@nestjs/common';

export const REQUIRED_ROLES = 'required_roles';

/**
 * Marks an endpoint for business-specific role configuration.
 * The key identifies the endpoint; allowed role IDs are stored in the database.
 */
export const RequiredRoles = (endpointKey: string) =>
  SetMetadata(REQUIRED_ROLES, endpointKey);
