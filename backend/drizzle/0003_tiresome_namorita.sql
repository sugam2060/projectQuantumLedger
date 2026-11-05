ALTER TABLE "business_memberships" ADD COLUMN "is_owner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_users" ADD COLUMN "is_bootstrap" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DROP POLICY "invitations_scope" ON "invitations" CASCADE;--> statement-breakpoint
DROP POLICY "platform_users_scope" ON "platform_users" CASCADE;--> statement-breakpoint
DROP POLICY "user_create_policy" ON "users" CASCADE;--> statement-breakpoint
CREATE POLICY "invitations_select" ON "invitations" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
            app_is_platform() = true
            OR (business_id = app_business_id() AND app_is_owner() = true)
            OR (business_id = app_business_id() AND (app_branch_id() IS NULL OR branch_id = app_branch_id()))
        );--> statement-breakpoint
CREATE POLICY "invitations_insert" ON "invitations" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
            app_is_platform() = true
            OR (business_id = app_business_id() AND app_is_owner() = true)
            OR (business_id = app_business_id() AND app_branch_id() IS NOT NULL AND branch_id = app_branch_id())
        );--> statement-breakpoint
CREATE POLICY "invitations_update" ON "invitations" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
            app_is_platform() = true
            OR (business_id = app_business_id() AND app_is_owner() = true)
            OR (business_id = app_business_id() AND (app_branch_id() IS NULL OR branch_id = app_branch_id()))
        ) WITH CHECK (
            app_is_platform() = true
            OR (business_id = app_business_id() AND app_is_owner() = true)
            OR (business_id = app_business_id() AND (app_branch_id() IS NULL OR branch_id = app_branch_id()))
        );--> statement-breakpoint
CREATE POLICY "invitations_delete" ON "invitations" AS PERMISSIVE FOR DELETE TO "fortis_app" USING (
            app_is_platform() = true
            OR (business_id = app_business_id() AND app_is_owner() = true)
            OR (business_id = app_business_id() AND (app_branch_id() IS NULL OR branch_id = app_branch_id()))
        );--> statement-breakpoint
CREATE POLICY "platform_users_select" ON "platform_users" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
            id = app_platform_user_id()
        );--> statement-breakpoint
CREATE POLICY "platform_users_insert" ON "platform_users" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
            app_is_bootstrap_platform() = true
        );--> statement-breakpoint
CREATE POLICY "platform_users_update" ON "platform_users" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
            id = app_platform_user_id() 
            OR app_is_bootstrap_platform() = true
        ) WITH CHECK (
            id = app_platform_user_id() 
            OR app_is_bootstrap_platform() = true
        );--> statement-breakpoint
CREATE POLICY "platform_users_delete" ON "platform_users" AS PERMISSIVE FOR DELETE TO "fortis_app" USING (
            app_is_bootstrap_platform() = true
        );--> statement-breakpoint
CREATE POLICY "users_insert" ON "users" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
            EXISTS (
                SELECT 1 FROM invitations 
                WHERE email_normalized = "users"."email_normalized"
                AND consumed_at IS NULL
                AND revoked_at IS NULL
            )
            OR public.app_is_platform() = true
        );--> statement-breakpoint
ALTER POLICY "branches_insert" ON "branches" TO fortis_app WITH CHECK (
            app_is_platform() = true
        );--> statement-breakpoint
ALTER POLICY "branches_update" ON "branches" TO fortis_app USING (
            (business_id = app_business_id() AND app_is_owner() = true)
            OR app_is_platform() = true
        ) WITH CHECK (
            (business_id = app_business_id() AND app_is_owner() = true)
            OR app_is_platform() = true
        );--> statement-breakpoint
ALTER POLICY "business_select" ON "business" TO fortis_app USING (
            (id = app_business_id() AND app_is_owner() = true)
            OR app_is_platform() = true
        );--> statement-breakpoint
ALTER POLICY "business_update" ON "business" TO fortis_app USING (
            (id = app_business_id() AND app_is_owner() = true)
            OR app_is_platform() = true
        ) WITH CHECK (
            (id = app_business_id() AND app_is_owner() = true)
            OR app_is_platform() = true
        );--> statement-breakpoint
ALTER POLICY "roles_insert" ON "roles" TO fortis_app WITH CHECK (
            (business_id = app_business_id() AND (app_is_owner() = true OR app_branch_id() IS NOT NULL))
            OR app_is_platform() = true
        );--> statement-breakpoint
ALTER POLICY "roles_update" ON "roles" TO fortis_app USING (
            (business_id = app_business_id() AND (app_is_owner() = true OR app_branch_id() IS NOT NULL))
            OR app_is_platform() = true
        ) WITH CHECK (
            (business_id = app_business_id() AND (app_is_owner() = true OR app_branch_id() IS NOT NULL))
            OR app_is_platform() = true
        );--> statement-breakpoint
ALTER POLICY "terminals_select" ON "terminals" TO fortis_app USING (
            (business_id = app_business_id() AND (app_branch_id() IS NULL OR branch_id = app_branch_id()))
            OR app_is_platform() = true
        );--> statement-breakpoint
ALTER POLICY "terminals_insert" ON "terminals" TO fortis_app WITH CHECK (
            app_is_platform() = true
        );--> statement-breakpoint
ALTER POLICY "terminals_update" ON "terminals" TO fortis_app USING (
            app_is_platform() = true
        ) WITH CHECK (
            app_is_platform() = true
        );--> statement-breakpoint
ALTER POLICY "users_select" ON "users" TO fortis_app USING (
            id = public.app_user_id()
            OR EXISTS (
                SELECT 1 FROM business_memberships m1
                JOIN business_memberships m2 ON m1.business_id = m2.business_id
                WHERE m1.user_id = public.app_user_id() 
                  AND m2.user_id = users.id 
                  AND m1.business_id = public.app_business_id()
                  AND m1.is_active = true
                  AND m2.is_active = true
            )
            OR public.app_is_platform() = true
        );--> statement-breakpoint
ALTER POLICY "users_update" ON "users" TO fortis_app USING (
            id = public.app_user_id()
            OR public.app_is_platform() = true
        ) WITH CHECK (
            id = public.app_user_id()
            OR public.app_is_platform() = true
        );