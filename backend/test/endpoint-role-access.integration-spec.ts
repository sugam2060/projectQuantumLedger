import { Pool } from 'pg';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase('Endpoint role access database integration', () => {
  const pool = new Pool({ connectionString: testDatabaseUrl });

  afterAll(async () => {
    await pool.end();
  });

  it('has tenant RLS enabled with scoped reads and owner-only writes', async () => {
    const result = await pool.query<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: string[];
      has_business_role_fk: boolean;
      select_is_business_scoped: boolean;
      insert_requires_owner: boolean;
      insert_scopes_role_to_business: boolean;
      delete_requires_owner: boolean;
    }>(`
      SELECT
        c.relrowsecurity,
        c.relforcerowsecurity,
        ARRAY(
          SELECT p.polname
          FROM pg_policy p
          WHERE p.polrelid = c.oid
        ) AS policies,
        EXISTS (
          SELECT 1
          FROM pg_constraint constraint_row
          WHERE constraint_row.conrelid = c.oid
            AND constraint_row.conname = 'endpoint_role_access_role_id_roles_id_fk'
            AND constraint_row.contype = 'f'
        ) AS has_business_role_fk
        ,EXISTS (
          SELECT 1
          FROM pg_policy p
          WHERE p.polrelid = c.oid
            AND p.polname = 'endpoint_role_access_select'
            AND pg_get_expr(p.polqual, p.polrelid) ILIKE '%app_business_id%'
        ) AS select_is_business_scoped
        ,EXISTS (
          SELECT 1
          FROM pg_policy p
          WHERE p.polrelid = c.oid
            AND p.polname = 'endpoint_role_access_insert'
            AND pg_get_expr(p.polwithcheck, p.polrelid) ILIKE '%app_is_owner%'
        ) AS insert_requires_owner
        ,EXISTS (
          SELECT 1
          FROM pg_policy p
          WHERE p.polrelid = c.oid
            AND p.polname = 'endpoint_role_access_insert'
            AND pg_get_expr(p.polwithcheck, p.polrelid) ILIKE '%roles.business_id%'
        ) AS insert_scopes_role_to_business
        ,EXISTS (
          SELECT 1
          FROM pg_policy p
          WHERE p.polrelid = c.oid
            AND p.polname = 'endpoint_role_access_delete'
            AND pg_get_expr(p.polqual, p.polrelid) ILIKE '%app_is_owner%'
        ) AS delete_requires_owner
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema()
        AND c.relname = 'endpoint_role_access'
    `);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].relrowsecurity).toBe(true);
    expect(result.rows[0].relforcerowsecurity).toBe(true);
    expect(result.rows[0].policies).toEqual(
      expect.arrayContaining([
        'endpoint_role_access_select',
        'endpoint_role_access_insert',
        'endpoint_role_access_delete',
      ]),
    );
    expect(result.rows[0].has_business_role_fk).toBe(true);
    expect(result.rows[0].select_is_business_scoped).toBe(true);
    expect(result.rows[0].insert_requires_owner).toBe(true);
    expect(result.rows[0].insert_scopes_role_to_business).toBe(true);
    expect(result.rows[0].delete_requires_owner).toBe(true);
  });

  it('allows platform login to select only the email in its RLS context', async () => {
    const result = await pool.query<{
      email_scoped_policy: boolean;
      legacy_lookup_function_removed: boolean;
    }>(`
      SELECT
        EXISTS (
          SELECT 1
          FROM pg_policy p
          JOIN pg_class c ON c.oid = p.polrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = current_schema()
            AND c.relname = 'platform_users'
            AND p.polname = 'platform_users_select'
            AND pg_get_expr(p.polqual, p.polrelid) ILIKE '%app.platform_auth_email%'
        ) AS email_scoped_policy,
        to_regprocedure('public.lookup_platform_user_for_auth(text)') IS NULL
          AS legacy_lookup_function_removed
    `);

    expect(result.rows[0].email_scoped_policy).toBe(true);
    expect(result.rows[0].legacy_lookup_function_removed).toBe(true);
  });
});
