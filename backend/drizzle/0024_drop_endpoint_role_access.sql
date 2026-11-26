DROP POLICY "endpoint_role_access_select" ON "endpoint_role_access" CASCADE;--> statement-breakpoint
DROP POLICY "endpoint_role_access_insert" ON "endpoint_role_access" CASCADE;--> statement-breakpoint
DROP POLICY "endpoint_role_access_delete" ON "endpoint_role_access" CASCADE;--> statement-breakpoint
DROP TABLE "endpoint_role_access" CASCADE;--> statement-breakpoint
ALTER TABLE "roles" DROP COLUMN "permissions";--> statement-breakpoint
-- Duplicate of business_memberships_role_required_chk (added by 0004, never in the schema).
ALTER TABLE "business_memberships" DROP CONSTRAINT IF EXISTS "business_memberships_role_required_for_non_owner_chk";
