import { closePools, owner } from './helpers/test-db';

/**
 * Baseline guarantees of the migration pipeline: the runtime role cannot bypass
 * RLS and every application table has RLS enabled.
 */
describe('database roles and RLS baseline', () => {
  afterAll(closePools);

  it('runs the app as a non-superuser role that cannot bypass RLS', async () => {
    const { rows } = await owner().query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
    }>(
      `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
         FROM pg_roles WHERE rolname = 'fortis_app'`,
    );
    expect(rows).toEqual([
      {
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
      },
    ]);
  });

  it('enables RLS on every application table', async () => {
    const { rows } = await owner().query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relname NOT LIKE '%drizzle%'
          AND NOT c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it('does not let the runtime role own any table', async () => {
    const { rows } = await owner().query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tableowner = 'fortis_app'`,
    );
    expect(rows).toEqual([]);
  });
});
