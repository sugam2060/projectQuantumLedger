CREATE OR REPLACE FUNCTION public.app_business_id()
RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.business_id', true), '')::UUID;
EXCEPTION
    WHEN others THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_branch_id()
RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.branch_id', true), '')::UUID;
EXCEPTION
    WHEN others THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_user_id()
RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.user_id', true), '')::UUID;
EXCEPTION
    WHEN others THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_is_platform()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN COALESCE(current_setting('app.is_platform_user', true), 'false') IN ('true', '1', 't', 'yes');
EXCEPTION
    WHEN others THEN
        RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE;--> statement-breakpoint
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
ALTER TABLE "branches" ADD CONSTRAINT "branches_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business" ADD CONSTRAINT "business_created_by_platform_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_platform_user_id_platform_users_id_fk" FOREIGN KEY ("invited_by_platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branches_business_code_uq" ON "branches" USING btree ("business_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "business_pan_uq" ON "business" USING btree ("pan");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_one_open_per_email_uq" ON "invitations" USING btree ("business_id","email_normalized") WHERE consumed_at IS NULL AND revoked_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_users_email_uq" ON "platform_users" USING btree ("email_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_business_name_uq" ON "roles" USING btree ("business_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email_normalized");--> statement-breakpoint
CREATE POLICY "branches_select" ON "branches" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
            business_id = app_business_id()
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "branches_insert" ON "branches" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
            business_id = app_business_id()
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "branches_update" ON "branches" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
            business_id = app_business_id()
            OR app_is_platform() = true
        ) WITH CHECK (
            business_id = app_business_id()
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "business_select" ON "business" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
            id = app_business_id()
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "business_update" ON "business" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
            id = app_business_id()
            OR app_is_platform() = true
        ) WITH CHECK (
            id = app_business_id()
            OR
            app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "business_insert" ON "business" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
            app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "invitations_scope" ON "invitations" AS PERMISSIVE FOR ALL TO "fortis_app" USING (business_id = app_business_id() AND (app_branch_id() IS NULL OR branch_id = app_branch_id())) WITH CHECK (business_id = app_business_id() AND (app_branch_id() IS NULL OR branch_id = app_branch_id()));--> statement-breakpoint
CREATE POLICY "platform_users_scope" ON "platform_users" AS PERMISSIVE FOR ALL TO "fortis_app" USING (
            app_is_platform() = true
            OR id = current_setting('app.platform_user_id', true)::uuid
        ) WITH CHECK (
            app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "roles_select" ON "roles" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
            business_id = app_business_id()
            OR business_id IS NULL
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "roles_insert" ON "roles" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
            business_id = app_business_id()
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "roles_update" ON "roles" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
            business_id = app_business_id()
            OR app_is_platform() = true
        ) WITH CHECK (
            business_id = app_business_id()
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "user_create_policy" ON "users" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
            EXISTS (
                SELECT 1 FROM invitations 
                WHERE email_normalized = "users"."email_normalized"
                AND consumed_at IS NULL
                AND revoked_at IS NULL
            )
        );--> statement-breakpoint
CREATE POLICY "users_update" ON "users" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (id = app_user_id()) WITH CHECK (id = app_user_id());