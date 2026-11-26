CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_key_chk" CHECK (key ~ '^[a-z]+(:[a-z_]+)+$')
);
--> statement-breakpoint
ALTER TABLE "permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member_permission_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"effect" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_permission_overrides_effect_chk" CHECK (effect IN ('allow', 'deny'))
);
--> statement-breakpoint
ALTER TABLE "member_permission_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_users" ADD COLUMN "role" text DEFAULT 'support' NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_permission_overrides" ADD CONSTRAINT "member_permission_overrides_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_permission_overrides" ADD CONSTRAINT "member_permission_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_permission_overrides" ADD CONSTRAINT "member_permission_overrides_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_permission_overrides" ADD CONSTRAINT "member_permission_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_permission_overrides_member_key_uq" ON "member_permission_overrides" USING btree ("business_id","user_id","permission_key");--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_business_key_uq" ON "roles" USING btree (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid),"key");--> statement-breakpoint
ALTER TABLE "platform_users" ADD CONSTRAINT "platform_users_role_chk" CHECK (role IN ('admin', 'manager', 'support'));--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_key_chk" CHECK (key IS NULL OR key ~ '^[a-z0-9]+(-[a-z0-9]+)*$');--> statement-breakpoint
-- Roles without a business can only be system roles.
UPDATE "roles" SET "is_system" = true WHERE "business_id" IS NULL AND NOT "is_system";--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_system_chk" CHECK ((is_system AND business_id IS NULL AND branch_id IS NULL) OR (NOT is_system AND business_id IS NOT NULL));--> statement-breakpoint
CREATE POLICY "roles_delete" ON "roles" AS PERMISSIVE FOR DELETE TO "fortis_app" USING (
        NOT is_system AND app.has_permission(business_id, NULL, 'role:delete')
      );--> statement-breakpoint
CREATE POLICY "permissions_select" ON "permissions" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (true);--> statement-breakpoint
CREATE POLICY "role_permissions_select" ON "role_permissions" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id));--> statement-breakpoint
CREATE POLICY "role_permissions_insert" ON "role_permissions" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (app.can_manage_role(role_id));--> statement-breakpoint
CREATE POLICY "role_permissions_delete" ON "role_permissions" AS PERMISSIVE FOR DELETE TO "fortis_app" USING (app.can_manage_role(role_id));--> statement-breakpoint
CREATE POLICY "member_permission_overrides_select" ON "member_permission_overrides" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
        user_id = app.current_user_id()
        OR app.has_permission(business_id, NULL, 'member:read')
        OR app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "member_permission_overrides_insert" ON "member_permission_overrides" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (app.has_permission(business_id, NULL, 'override:manage'));--> statement-breakpoint
CREATE POLICY "member_permission_overrides_update" ON "member_permission_overrides" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (app.has_permission(business_id, NULL, 'override:manage')) WITH CHECK (app.has_permission(business_id, NULL, 'override:manage'));--> statement-breakpoint
CREATE POLICY "member_permission_overrides_delete" ON "member_permission_overrides" AS PERMISSIVE FOR DELETE TO "fortis_app" USING (app.has_permission(business_id, NULL, 'override:manage'));--> statement-breakpoint
ALTER POLICY "branches_update" ON "branches" TO fortis_app USING (
        app.has_permission(business_id, id, 'branch:update') OR app.is_platform_user()
      ) WITH CHECK (
        app.has_permission(business_id, id, 'branch:update') OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "business_select" ON "business" TO fortis_app USING (
        app.has_permission(id, NULL, 'business:read')
        OR app.is_platform_user()
        OR EXISTS (
          SELECT 1
          FROM owner_redemptions r
          WHERE r.business_id = business.id
            AND r.email_normalized = NULLIF(current_setting('app.registration_email', true), '')
            AND r.token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
            AND r.consumed_at IS NULL
            AND r.revoked_at IS NULL
            AND r.expires_at > now()
        )
      );--> statement-breakpoint
ALTER POLICY "business_update" ON "business" TO fortis_app USING (
        app.has_permission(id, NULL, 'business:update') OR app.is_platform_user()
      ) WITH CHECK (
        app.has_permission(id, NULL, 'business:update') OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "business_memberships_update" ON "business_memberships" TO fortis_app USING (
        app.has_permission(business_id, branch_id, 'member:update')
        OR app.has_permission(business_id, branch_id, 'member:end')
        OR app.is_platform_user()
      ) WITH CHECK (
        app.has_permission(business_id, branch_id, 'member:update')
        OR app.has_permission(business_id, branch_id, 'member:end')
        OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "invitations_select" ON "invitations" TO fortis_app USING (
        app.is_platform_user() OR (business_id IS NOT NULL AND app.has_permission(business_id, branch_id, 'member:read'))
      );--> statement-breakpoint
ALTER POLICY "invitations_insert" ON "invitations" TO fortis_app WITH CHECK (
        app.is_platform_user() OR (business_id IS NOT NULL AND app.has_permission(business_id, branch_id, 'member:invite'))
      );--> statement-breakpoint
ALTER POLICY "invitations_update" ON "invitations" TO fortis_app USING (
        app.is_platform_user() OR (business_id IS NOT NULL AND app.has_permission(business_id, branch_id, 'member:invite'))
      ) WITH CHECK (
        app.is_platform_user() OR (business_id IS NOT NULL AND app.has_permission(business_id, branch_id, 'member:invite'))
      );--> statement-breakpoint
ALTER POLICY "invitations_delete" ON "invitations" TO fortis_app USING (
        app.is_platform_user() OR (business_id IS NOT NULL AND app.has_permission(business_id, branch_id, 'member:invite'))
      );--> statement-breakpoint
ALTER POLICY "roles_insert" ON "roles" TO fortis_app WITH CHECK (
        NOT is_system
        AND business_id IS NOT NULL
        AND app.has_permission(business_id, NULL, 'role:create')
      );--> statement-breakpoint
ALTER POLICY "roles_update" ON "roles" TO fortis_app USING (
        NOT is_system AND app.has_permission(business_id, NULL, 'role:update')
      ) WITH CHECK (
        NOT is_system AND app.has_permission(business_id, NULL, 'role:update')
      );--> statement-breakpoint
ALTER POLICY "terminals_owner_activate" ON "terminals" TO fortis_app USING (
        app.has_permission(business_id, branch_id, 'terminal:activate')
        AND business_id = NULLIF(current_setting('app.terminal_activation_business_id', true), '')::uuid
        AND branch_id = NULLIF(current_setting('app.terminal_activation_branch_id', true), '')::uuid
        AND terminal_code = NULLIF(current_setting('app.terminal_activation_code', true), '')
        AND status = 'inactive'
      ) WITH CHECK (
        app.has_permission(business_id, branch_id, 'terminal:activate')
        AND business_id = NULLIF(current_setting('app.terminal_activation_business_id', true), '')::uuid
        AND branch_id = NULLIF(current_setting('app.terminal_activation_branch_id', true), '')::uuid
        AND terminal_code = NULLIF(current_setting('app.terminal_activation_code', true), '')
        AND status = 'active'
      );--> statement-breakpoint
ALTER POLICY "access_logs_select" ON "access_logs" TO fortis_app USING (
        user_id = app.current_user_id()
        OR (business_id IS NOT NULL AND app.has_permission(business_id, NULL, 'audit:read'))
        OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "audit_logs_select" ON "audit_logs" TO fortis_app USING (
        app.has_permission(business_id, NULL, 'audit:read') OR app.is_platform_user()
      );