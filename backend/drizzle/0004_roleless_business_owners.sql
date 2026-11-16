ALTER TABLE "business_memberships" ALTER COLUMN "role_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_role_required_for_non_owner_chk" CHECK (is_owner = true OR role_id IS NOT NULL);
--> statement-breakpoint
ALTER POLICY "business_memberships_insert" ON "business_memberships" TO fortis_app WITH CHECK (
            (business_id = app_business_id() AND app_is_owner() = true)
            OR app_is_platform() = true
        );
