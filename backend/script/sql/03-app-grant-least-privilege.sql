-- 03: least-privilege grants for fortis_app. Applied after the Drizzle
-- migrations (tables must exist). Idempotent, re-run on every migration.
--
-- fortis_app gets DML on application tables (RLS decides which rows), EXECUTE on
-- the app.* functions, and nothing else: no DDL, no migration ledger, and PUBLIC
-- loses its default rights on both schemas.

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO fortis_app;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO fortis_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Table privileges let the application perform its operations; RLS policies
-- limit the rows each request can see or change. Keep the migration ledger
-- inaccessible to the runtime role.
DO $grant_application_tables$
DECLARE
  table_record RECORD;
BEGIN
  FOR table_record IN
    SELECT schemaname, tablename
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '__drizzle_migrations'
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO fortis_app',
      table_record.schemaname,
      table_record.tablename
    );
  END LOOP;
END
$grant_application_tables$;

GRANT USAGE ON SCHEMA public TO fortis_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fortis_app;

REVOKE ALL ON FUNCTION
  public.app_business_id(),
  public.app_branch_id(),
  public.app_user_id(),
  public.app_is_platform(),
  public.app_is_owner(),
  public.app_platform_user_id(),
  public.app_is_bootstrap_platform()
FROM PUBLIC;

-- Legacy helpers: still defined because historical migrations (0000-0017)
-- create policies that call them, but no live policy does any more. The runtime
-- role may not call them, so any leftover dependency fails loudly.
REVOKE EXECUTE ON FUNCTION
  public.app_business_id(),
  public.app_branch_id(),
  public.app_user_id(),
  public.app_is_platform(),
  public.app_is_owner(),
  public.app_platform_user_id(),
  public.app_is_bootstrap_platform()
FROM fortis_app;

-- Applies to future objects created by the migration connection's role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fortis_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO fortis_app;

DO $revoke_migration_ledger$
BEGIN
  IF pg_catalog.to_regclass('public.__drizzle_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.__drizzle_migrations FROM fortis_app';
  END IF;
END
$revoke_migration_ledger$;
