-- 00: runtime role. Applied by script/migrate.ts before everything else, because
-- Drizzle policies are created `TO fortis_app`.
--
-- fortis_app is the least-privileged LOGIN role the API connects with
-- (DATABASE_URL). It never owns tables, cannot bypass RLS and has no DDL rights.
-- Its password is set separately by migrate.ts through a bind parameter, so it
-- never appears in this file or in a SQL string.
DO $provision_role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'fortis_app') THEN
    CREATE ROLE fortis_app LOGIN;
  END IF;

  ALTER ROLE fortis_app
    LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;

  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO fortis_app',
    pg_catalog.current_database()
  );
END
$provision_role$;
