ALTER TABLE "business_memberships" DROP CONSTRAINT "business_memberships_role_required_chk";--> statement-breakpoint
ALTER TABLE "business_memberships" DROP CONSTRAINT "business_memberships_role_id_roles_id_fk";
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "platform_role" text;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_role_required_chk" CHECK (is_owner = true OR role_id IS NOT NULL OR is_active = false);--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_platform_role_chk" CHECK (platform_role IS NULL OR (invitation_type = 'platform_user' AND platform_role IN ('admin', 'manager', 'support')));--> statement-breakpoint
DROP POLICY "roles_insert" ON "roles" CASCADE;--> statement-breakpoint
DROP POLICY "roles_update" ON "roles" CASCADE;--> statement-breakpoint
DROP POLICY "roles_delete" ON "roles" CASCADE;--> statement-breakpoint
DROP POLICY "role_permissions_insert" ON "role_permissions" CASCADE;--> statement-breakpoint
DROP POLICY "role_permissions_delete" ON "role_permissions" CASCADE;--> statement-breakpoint
DROP POLICY "member_permission_overrides_insert" ON "member_permission_overrides" CASCADE;--> statement-breakpoint
DROP POLICY "member_permission_overrides_update" ON "member_permission_overrides" CASCADE;--> statement-breakpoint
DROP POLICY "member_permission_overrides_delete" ON "member_permission_overrides" CASCADE;--> statement-breakpoint
ALTER POLICY "business_memberships_select" ON "business_memberships" TO fortis_app USING (
        user_id = app.current_user_id()
        OR app.has_permission(business_id, branch_id, 'member:read')
        OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "business_memberships_update" ON "business_memberships" TO fortis_app USING (app.is_platform_user()) WITH CHECK (app.is_platform_user());--> statement-breakpoint
ALTER POLICY "invitations_insert" ON "invitations" TO fortis_app WITH CHECK (
        app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "invitations_update" ON "invitations" TO fortis_app USING (
        app.is_platform_user()
      ) WITH CHECK (
        app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "invitations_delete" ON "invitations" TO fortis_app USING (
        app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "users_select" ON "users" TO fortis_app USING (
        id = app.current_user_id()
        OR (
          email_normalized = NULLIF(current_setting('app.registration_email', true), '')
          AND EXISTS (
          SELECT 1 FROM owner_redemptions r
          WHERE r.email_normalized = users.email_normalized
            AND r.token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
            AND r.consumed_at IS NULL
            AND r.revoked_at IS NULL
            AND r.expires_at > now()
        )
        )
        OR EXISTS (
          SELECT 1 FROM business_memberships m
          WHERE m.user_id = users.id
            AND m.is_active
            AND app.has_permission(m.business_id, m.branch_id, 'member:read')
        )
        OR app.is_platform_user()
      );