-- Create the least-privileged runtime login if it does not already exist.
-- migrate.ts substitutes a quoted password from FORTIS_APP_DB_PASSWORD (or
-- DATABASE_URL when it uses fortis_app) only when creating a new role.
DO $provision_role$
DECLARE
  app_password TEXT := __FORTIS_APP_PASSWORD_LITERAL__;
  current_role_can_login BOOLEAN;
BEGIN
  SELECT rolcanlogin
  INTO current_role_can_login
  FROM pg_catalog.pg_roles
  WHERE rolname = 'fortis_app';

  IF NOT FOUND THEN
    IF app_password IS NULL THEN
      RAISE EXCEPTION
        'Set FORTIS_APP_DB_PASSWORD or configure DATABASE_URL with fortis_app credentials to provision the runtime role';
    END IF;
    EXECUTE pg_catalog.format(
      'CREATE ROLE fortis_app LOGIN PASSWORD %L',
      app_password
    );
  ELSIF current_role_can_login IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'fortis_app exists but is not a LOGIN role';
  END IF;

  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO fortis_app',
    pg_catalog.current_database()
  );
  EXECUTE 'GRANT USAGE ON SCHEMA public TO fortis_app';
END
$provision_role$;
