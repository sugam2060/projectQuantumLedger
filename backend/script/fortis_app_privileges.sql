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

GRANT EXECUTE ON FUNCTION
  public.app_business_id(),
  public.app_branch_id(),
  public.app_user_id(),
  public.app_is_platform(),
  public.app_is_owner(),
  public.app_platform_user_id(),
  public.app_is_bootstrap_platform()
TO fortis_app;

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
