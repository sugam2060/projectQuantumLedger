import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { owner } from './test-db';

/**
 * Test data written as the table owner (bypassing RLS), so each test can arrange
 * exactly the rows it needs. Every factory returns the new row's id.
 */

const unique = (): string => randomUUID().slice(0, 8);

export const TEST_PASSWORD = 'Correct-Horse-Battery-9';

async function insert(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await owner().query<{ id: string }>(sql, params);
  return rows[0].id;
}

export async function createPlatformUser(
  overrides: { email?: string; isBootstrap?: boolean; status?: string } = {},
): Promise<{ id: string; email: string }> {
  const email = overrides.email ?? `staff-${unique()}@fortis.test`;
  const id = await insert(
    `INSERT INTO platform_users (email_normalized, password_hash, name, status, is_bootstrap)
     VALUES ($1, $2, 'Platform Staff', $3, $4) RETURNING id`,
    [
      email,
      await bcrypt.hash(TEST_PASSWORD, 4),
      overrides.status ?? 'active',
      overrides.isBootstrap ?? false,
    ],
  );
  return { id, email };
}

export async function createBusiness(
  overrides: { createdBy?: string; isActive?: boolean } = {},
): Promise<string> {
  const createdBy = overrides.createdBy ?? (await createPlatformUser()).id;
  return insert(
    `INSERT INTO business (legal_name, display_name, pan, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      `Business ${unique()} Pvt. Ltd.`,
      `Business ${unique()}`,
      `PAN${unique().toUpperCase()}`,
      overrides.isActive ?? true,
      createdBy,
    ],
  );
}

export async function createBranch(businessId: string): Promise<string> {
  return insert(
    `INSERT INTO branches (business_id, name, code)
     VALUES ($1, $2, $3) RETURNING id`,
    [businessId, `Branch ${unique()}`, `BR${unique().toUpperCase()}`],
  );
}

export async function createTerminal(
  businessId: string,
  branchId: string,
  status: 'active' | 'inactive' | 'maintenance' = 'active',
): Promise<string> {
  return insert(
    `INSERT INTO terminals (business_id, branch_id, name, terminal_code, status)
     VALUES ($1, $2, 'POS', $3, $4) RETURNING id`,
    [businessId, branchId, `POS-${unique().toUpperCase()}`, status],
  );
}

export async function createUser(
  overrides: { email?: string; status?: string } = {},
): Promise<{ id: string; email: string }> {
  const email = overrides.email ?? `user-${unique()}@fortis.test`;
  const id = await insert(
    `INSERT INTO users (email_normalized, password_hash, name, status)
     VALUES ($1, $2, 'Test User', $3) RETURNING id`,
    [email, await bcrypt.hash(TEST_PASSWORD, 4), overrides.status ?? 'active'],
  );
  return { id, email };
}

export async function createRole(
  businessId: string | null,
  name = `Role ${unique()}`,
): Promise<string> {
  return insert(
    `INSERT INTO roles (business_id, name) VALUES ($1, $2) RETURNING id`,
    [businessId, name],
  );
}

export async function createMembership(input: {
  businessId: string;
  userId: string;
  isOwner?: boolean;
  roleId?: string | null;
  branchId?: string | null;
  isActive?: boolean;
}): Promise<string> {
  return insert(
    `INSERT INTO business_memberships (business_id, user_id, is_owner, role_id, branch_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      input.businessId,
      input.userId,
      input.isOwner ?? false,
      input.roleId ?? null,
      input.branchId ?? null,
      input.isActive ?? true,
    ],
  );
}

/** A business with one branch, one active terminal and an owner. */
export async function createBusinessWithOwner(): Promise<{
  businessId: string;
  branchId: string;
  terminalId: string;
  owner: { id: string; email: string };
}> {
  const businessId = await createBusiness();
  const branchId = await createBranch(businessId);
  const terminalId = await createTerminal(businessId, branchId);
  const ownerUser = await createUser();
  await createMembership({
    businessId,
    userId: ownerUser.id,
    isOwner: true,
  });
  return { businessId, branchId, terminalId, owner: ownerUser };
}
