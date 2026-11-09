CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address" text,
	"contact_number" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_code_chk" CHECK (btrim(code) <> '')
);
--> statement-breakpoint
ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "business" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"pan" text NOT NULL,
	"address" text,
	"primary_contact_number" text,
	"primary_contact_email" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_pan_chk" CHECK (btrim(pan) <> '')
);
--> statement-breakpoint
ALTER TABLE "business" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "business_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"branch_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "endpoint_role_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"endpoint_key" text NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "endpoint_role_access_key_chk" CHECK (endpoint_key ~ '^[a-z][a-z0-9_.:-]{1,119}$')
);
--> statement-breakpoint
ALTER TABLE "endpoint_role_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"email_normalized" text NOT NULL,
	"role_id" uuid NOT NULL,
	"branch_id" uuid,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"invited_by_user_id" uuid,
	"invited_by_platform_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_email_chk" CHECK (email_normalized = lower(btrim(email_normalized))),
	CONSTRAINT "invitations_inviter_chk" CHECK (num_nonnulls(invited_by_user_id, invited_by_platform_user_id) = 1),
	CONSTRAINT "invitations_state_chk" CHECK (consumed_at IS NULL OR revoked_at IS NULL)
);
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_normalized" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_bootstrap" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_users_email_chk" CHECK (email_normalized = lower(btrim(email_normalized))),
	CONSTRAINT "platform_users_status_chk" CHECK (status IN ('active', 'disabled', 'suspended'))
);
--> statement-breakpoint
ALTER TABLE "platform_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_chk" CHECK (btrim(name) <> '')
);
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"terminal_code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terminals_name_chk" CHECK (btrim(name) <> ''),
	CONSTRAINT "terminals_status_chk" CHECK (status IN ('active', 'inactive', 'maintenance'))
);
--> statement-breakpoint
ALTER TABLE "terminals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_normalized" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_chk" CHECK (email_normalized = lower(btrim(email_normalized))),
	CONSTRAINT "users_status_chk" CHECK (status IN ('active', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"user_id" uuid,
	"event_type" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid,
	"terminal_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"table_name" text NOT NULL,
	"record_id" uuid,
	"old_values" jsonb,
	"new_values" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business" ADD CONSTRAINT "business_created_by_platform_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_role_access" ADD CONSTRAINT "endpoint_role_access_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_role_access" ADD CONSTRAINT "endpoint_role_access_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_platform_user_id_platform_users_id_fk" FOREIGN KEY ("invited_by_platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branches_business_code_uq" ON "branches" USING btree ("business_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "business_pan_uq" ON "business" USING btree ("pan");--> statement-breakpoint
CREATE UNIQUE INDEX "business_memberships_user_business_uq" ON "business_memberships" USING btree ("user_id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "endpoint_role_access_business_endpoint_role_uq" ON "endpoint_role_access" USING btree ("business_id","endpoint_key","role_id");--> statement-breakpoint
CREATE INDEX "endpoint_role_access_endpoint_idx" ON "endpoint_role_access" USING btree ("business_id","endpoint_key");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_one_open_per_email_uq" ON "invitations" USING btree ("business_id","email_normalized") WHERE consumed_at IS NULL AND revoked_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_users_email_uq" ON "platform_users" USING btree ("email_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_business_name_uq" ON "roles" USING btree ("business_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "terminals_branch_code_uq" ON "terminals" USING btree ("branch_id","terminal_code");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "access_logs_business_idx" ON "access_logs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "access_logs_user_idx" ON "access_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_business_idx" ON "audit_logs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "audit_logs_branch_idx" ON "audit_logs" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "audit_logs_table_record_idx" ON "audit_logs" USING btree ("table_name","record_id");--> statement-breakpoint
CREATE POLICY "branches_select" ON "branches" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
            business_id = app_business_id()
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "branches_insert" ON "branches" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
            app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "branches_update" ON "branches" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
            (business_id = app_business_id() AND app_is_owner() = true)
            OR app_is_platform() = true
        ) WITH CHECK (
            (business_id = app_business_id() AND app_is_owner() = true)
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "business_select" ON "business" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
            (id = app_business_id() AND app_is_owner() = true)
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "business_update" ON "business" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
            (id = app_business_id() AND app_is_owner() = true)
            OR app_is_platform() = true
        ) WITH CHECK (
            (id = app_business_id() AND app_is_owner() = true)
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "business_insert" ON "business" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
            app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "business_memberships_select" ON "business_memberships" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
            business_id = app_business_id()
            OR user_id = app_user_id()
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "business_memberships_insert" ON "business_memberships" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
            business_id = app_business_id()
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "business_memberships_update" ON "business_memberships" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
            business_id = app_business_id()
            OR app_is_platform() = true
        ) WITH CHECK (
            business_id = app_business_id()
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "endpoint_role_access_select" ON "endpoint_role_access" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
        business_id = app_business_id()
        OR app_is_platform() = true
      );--> statement-breakpoint
CREATE POLICY "endpoint_role_access_insert" ON "endpoint_role_access" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
        (business_id = app_business_id() AND app_is_owner() = true)
        AND EXISTS (
          SELECT 1
          FROM roles
          WHERE roles.id = endpoint_role_access.role_id
            AND (roles.business_id = endpoint_role_access.business_id OR roles.business_id IS NULL)
        )
        OR app_is_platform() = true
      );--> statement-breakpoint
CREATE POLICY "endpoint_role_access_delete" ON "endpoint_role_access" AS PERMISSIVE FOR DELETE TO "fortis_app" USING (
        (business_id = app_business_id() AND app_is_owner() = true)
        OR app_is_platform() = true
      );--> statement-breakpoint
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
CREATE POLICY "roles_select" ON "roles" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
            business_id = app_business_id()
            OR business_id IS NULL
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "roles_insert" ON "roles" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
            (business_id = app_business_id() AND (app_is_owner() = true OR app_branch_id() IS NOT NULL))
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "roles_update" ON "roles" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
            (business_id = app_business_id() AND (app_is_owner() = true OR app_branch_id() IS NOT NULL))
            OR app_is_platform() = true
        ) WITH CHECK (
            (business_id = app_business_id() AND (app_is_owner() = true OR app_branch_id() IS NOT NULL))
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "terminals_select" ON "terminals" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
            (business_id = app_business_id() AND (app_branch_id() IS NULL OR branch_id = app_branch_id()))
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "terminals_insert" ON "terminals" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
            app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "terminals_update" ON "terminals" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
            app_is_platform() = true
        ) WITH CHECK (
            app_is_platform() = true
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
CREATE POLICY "users_select" ON "users" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
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
CREATE POLICY "users_update" ON "users" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
            id = public.app_user_id()
            OR public.app_is_platform() = true
        ) WITH CHECK (
            id = public.app_user_id()
            OR public.app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "access_logs_select" ON "access_logs" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
            business_id = app_business_id()
            OR user_id = app_user_id()
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "access_logs_insert" ON "access_logs" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
            business_id = app_business_id()
            OR business_id IS NULL
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "audit_logs_select" ON "audit_logs" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
            business_id = app_business_id()
            AND (app_branch_id() IS NULL OR branch_id = app_branch_id())
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "audit_logs_insert" ON "audit_logs" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
            business_id = app_business_id()
            OR app_is_platform() = true
        );