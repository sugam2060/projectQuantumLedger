-- 00: runtime role. Applied by script/migrate.ts before everything else, because
-- Drizzle policies are created `TO fortis_app`.
--
-- fortis_app is the least-privileged LOGIN role the API connects with
-- (DATABASE_URL). It never owns tables, cannot bypass RLS and has no DDL rights.
-- Its password is set separately by migrate.ts through a bind parameter, so it
-- never appears in this file or in a SQL string.
--
-- Works without SUPERUSER (managed Postgres such as Neon, where the migration
-- user only has CREATEROLE): Postgres lets only superusers touch the SUPERUSER,
-- BYPASSRLS and REPLICATION attributes, even to switch them off. So the role is
-- created with safe attributes, only the attributes a CREATEROLE user may change
-- are corrected (and only when they differ), and the dangerous ones are verified
-- instead of altered: if any is set, or fortis_app is a member of any other
-- role, migration stops with an explanation.
DO $provision_role$
DECLARE
  r pg_catalog.pg_roles%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'fortis_app') THEN
    CREATE ROLE fortis_app
      LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
  END IF;

  SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname = 'fortis_app';

  IF r.rolsuper OR r.rolbypassrls OR r.rolreplication THEN
    RAISE EXCEPTION
      'fortis_app has SUPERUSER, BYPASSRLS or REPLICATION; row-level security would not protect tenant data'
      USING HINT = 'As a superuser run: ALTER ROLE fortis_app NOSUPERUSER NOBYPASSRLS NOREPLICATION; then migrate again.';
  END IF;

  -- NOINHERIT does not stop SET ROLE: membership in any other role (a table
  -- owner, a provider admin role, ...) would let the API escape RLS.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid
  ) THEN
    RAISE EXCEPTION 'fortis_app is a member of other roles; it could SET ROLE past row-level security'
      USING HINT = 'Revoke those memberships (see pg_auth_members where member is fortis_app), then migrate again.';
  END IF;

  IF NOT r.rolcanlogin THEN
    ALTER ROLE fortis_app LOGIN;
  END IF;
  IF r.rolcreatedb THEN
    ALTER ROLE fortis_app NOCREATEDB;
  END IF;
  IF r.rolcreaterole THEN
    ALTER ROLE fortis_app NOCREATEROLE;
  END IF;
  IF r.rolinherit THEN
    ALTER ROLE fortis_app NOINHERIT;
  END IF;

  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO fortis_app',
    pg_catalog.current_database()
  );
END
$provision_role$;
