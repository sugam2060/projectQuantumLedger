ALTER TABLE "roles"
  ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "roles"
  ADD CONSTRAINT "roles_version_chk" CHECK (version > 0);--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.bump_role_template_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.bump_role_template_version() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "roles_bump_template_version"
BEFORE UPDATE ON "roles"
FOR EACH ROW
EXECUTE FUNCTION public.bump_role_template_version();
