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
	"address_details" jsonb,
	"documents" jsonb,
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
CREATE TABLE "business_provisioning_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"documents" jsonb NOT NULL,
	"address" jsonb NOT NULL,
	"primary_contact_name" text NOT NULL,
	"primary_contact_email" text NOT NULL,
	"primary_contact_phone" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"provisioned_business_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_provisioning_requests_status_chk" CHECK (status IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "business_provisioning_requests_legal_name_chk" CHECK (btrim(legal_name) <> ''),
	CONSTRAINT "business_provisioning_requests_display_name_chk" CHECK (btrim(display_name) <> '')
);
--> statement-breakpoint
ALTER TABLE "business_provisioning_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "owner_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"email_normalized" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_platform_user_id" uuid NOT NULL,
	"consumed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_redemptions_email_chk" CHECK (email_normalized = lower(btrim(email_normalized))),
	CONSTRAINT "owner_redemptions_state_chk" CHECK (consumed_at IS NULL OR revoked_at IS NULL)
);
--> statement-breakpoint
ALTER TABLE "owner_redemptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "business_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid,
	"is_owner" boolean DEFAULT false NOT NULL,
	"branch_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_memberships_role_required_chk" CHECK (is_owner = true OR role_id IS NOT NULL OR is_active = false)
);
--> statement-breakpoint
ALTER TABLE "business_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"email_normalized" text NOT NULL,
	"role_id" uuid,
	"branch_id" uuid,
	"invitation_type" text DEFAULT 'business_user' NOT NULL,
	"invitee_name" text,
	"platform_role" text,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"invited_by_user_id" uuid,
	"invited_by_platform_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_type_chk" CHECK (invitation_type IN ('business_user', 'platform_user')),
	CONSTRAINT "invitations_target_chk" CHECK ((invitation_type = 'business_user' AND business_id IS NOT NULL AND role_id IS NOT NULL) OR (invitation_type = 'platform_user' AND business_id IS NULL AND role_id IS NULL AND branch_id IS NULL AND invitee_name IS NOT NULL AND btrim(invitee_name) <> '' AND invited_by_platform_user_id IS NOT NULL)),
	CONSTRAINT "invitations_platform_role_chk" CHECK (platform_role IS NULL OR (invitation_type = 'platform_user' AND platform_role IN ('admin', 'manager', 'support'))),
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
	"role" text DEFAULT 'support' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_users_email_chk" CHECK (email_normalized = lower(btrim(email_normalized))),
	CONSTRAINT "platform_users_role_chk" CHECK (role IN ('admin', 'manager', 'support')),
	CONSTRAINT "platform_users_status_chk" CHECK (status IN ('active', 'disabled', 'suspended'))
);
--> statement-breakpoint
ALTER TABLE "platform_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"branch_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_chk" CHECK (btrim(name) <> ''),
	CONSTRAINT "roles_version_chk" CHECK (version > 0),
	CONSTRAINT "roles_key_chk" CHECK (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "roles_system_chk" CHECK ((is_system AND business_id IS NULL AND branch_id IS NULL) OR (NOT is_system AND business_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
CREATE TABLE "terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"terminal_code" text NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
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
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"platform_user_id" uuid,
	"refresh_token_hash" text NOT NULL,
	"client_type" text NOT NULL,
	"terminal_id" uuid,
	"persistent" boolean DEFAULT false NOT NULL,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	CONSTRAINT "sessions_one_actor_chk" CHECK (num_nonnulls(user_id, platform_user_id) = 1),
	CONSTRAINT "sessions_hash_chk" CHECK (refresh_token_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"user_id" uuid,
	"event_type" text NOT NULL,
	"http_method" text,
	"endpoint_path" text,
	"response_status" integer,
	"request_id" text,
	"client_type" text,
	"terminal_id" uuid,
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
CREATE TABLE "platform_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_user_id" uuid NOT NULL,
	"business_id" uuid,
	"request_id" uuid,
	"action" text NOT NULL,
	"http_method" text,
	"endpoint_path" text,
	"response_status" integer,
	"correlation_id" text,
	"client_type" text,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"platform_user_id" uuid,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "password_reset_tokens_one_actor_chk" CHECK (num_nonnulls(user_id, platform_user_id) = 1),
	CONSTRAINT "password_reset_tokens_hash_chk" CHECK (token_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business" ADD CONSTRAINT "business_created_by_platform_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_provisioning_requests" ADD CONSTRAINT "business_provisioning_requests_reviewed_by_platform_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_provisioning_requests" ADD CONSTRAINT "business_provisioning_requests_provisioned_business_id_business_id_fk" FOREIGN KEY ("provisioned_business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_redemptions" ADD CONSTRAINT "owner_redemptions_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_redemptions" ADD CONSTRAINT "owner_redemptions_request_id_business_provisioning_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."business_provisioning_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_redemptions" ADD CONSTRAINT "owner_redemptions_created_by_platform_user_id_platform_users_id_fk" FOREIGN KEY ("created_by_platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_redemptions" ADD CONSTRAINT "owner_redemptions_consumed_by_user_id_users_id_fk" FOREIGN KEY ("consumed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_platform_user_id_platform_users_id_fk" FOREIGN KEY ("invited_by_platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_permission_overrides" ADD CONSTRAINT "member_permission_overrides_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_permission_overrides" ADD CONSTRAINT "member_permission_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_permission_overrides" ADD CONSTRAINT "member_permission_overrides_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_permission_overrides" ADD CONSTRAINT "member_permission_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_request_id_business_provisioning_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."business_provisioning_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branches_business_code_uq" ON "branches" USING btree ("business_id","code");--> statement-breakpoint
CREATE INDEX "branches_business_created_id_idx" ON "branches" USING btree ("business_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_pan_uq" ON "business" USING btree ("pan");--> statement-breakpoint
CREATE INDEX "business_provisioning_requests_status_created_idx" ON "business_provisioning_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "business_provisioning_requests_contact_email_idx" ON "business_provisioning_requests" USING btree ("primary_contact_email");--> statement-breakpoint
CREATE INDEX "business_provisioning_requests_provisioned_business_uq" ON "business_provisioning_requests" USING btree ("provisioned_business_id") WHERE provisioned_business_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "owner_redemptions_token_hash_uq" ON "owner_redemptions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_redemptions_request_uq" ON "owner_redemptions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "owner_redemptions_business_email_idx" ON "owner_redemptions" USING btree ("business_id","email_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "business_memberships_user_business_uq" ON "business_memberships" USING btree ("user_id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_memberships_one_active_user_uq" ON "business_memberships" USING btree ("user_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "business_memberships_business_branch_active_idx" ON "business_memberships" USING btree ("business_id","branch_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_uq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_one_open_per_email_uq" ON "invitations" USING btree ("business_id","email_normalized") WHERE invitation_type = 'business_user' AND consumed_at IS NULL AND revoked_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_user_invitations_one_open_per_email_uq" ON "invitations" USING btree ("email_normalized") WHERE invitation_type = 'platform_user' AND consumed_at IS NULL AND revoked_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_users_email_uq" ON "platform_users" USING btree ("email_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_business_name_uq" ON "roles" USING btree ("business_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_business_key_uq" ON "roles" USING btree (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid),"key");--> statement-breakpoint
CREATE UNIQUE INDEX "member_permission_overrides_member_key_uq" ON "member_permission_overrides" USING btree ("business_id","user_id","permission_key");--> statement-breakpoint
CREATE UNIQUE INDEX "terminals_branch_code_uq" ON "terminals" USING btree ("branch_id","terminal_code");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_token_hash_uq" ON "sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_active_idx" ON "sessions" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "sessions_platform_user_active_idx" ON "sessions" USING btree ("platform_user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "access_logs_business_idx" ON "access_logs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "access_logs_user_idx" ON "access_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_business_idx" ON "audit_logs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "audit_logs_branch_idx" ON "audit_logs" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "audit_logs_table_record_idx" ON "audit_logs" USING btree ("table_name","record_id");--> statement-breakpoint
CREATE INDEX "platform_audit_logs_actor_created_idx" ON "platform_audit_logs" USING btree ("platform_user_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_logs_request_idx" ON "platform_audit_logs" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_hash_uq" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE POLICY "branches_select" ON "branches" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
        app.can_access_branch(business_id, id) OR app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "branches_insert" ON "branches" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
        app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "branches_update" ON "branches" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
        app.has_permission(business_id, id, 'branch:update') OR app.is_platform_user()
      ) WITH CHECK (
        app.has_permission(business_id, id, 'branch:update') OR app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "business_select" ON "business" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
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
CREATE POLICY "business_update" ON "business" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
        app.has_permission(id, NULL, 'business:update') OR app.is_platform_user()
      ) WITH CHECK (
        app.has_permission(id, NULL, 'business:update') OR app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "business_insert" ON "business" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
        app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "business_provisioning_requests_public_insert" ON "business_provisioning_requests" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "business_provisioning_requests_platform_select" ON "business_provisioning_requests" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
        app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "business_provisioning_requests_platform_update" ON "business_provisioning_requests" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
        app.is_platform_user()
      ) WITH CHECK (
        app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "owner_redemptions_select" ON "owner_redemptions" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
        app.is_platform_user() OR token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
      );--> statement-breakpoint
CREATE POLICY "owner_redemptions_insert" ON "owner_redemptions" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
        app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "owner_redemptions_update" ON "owner_redemptions" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
        app.is_platform_user() OR token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
      ) WITH CHECK (
        app.is_platform_user() OR token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
      );--> statement-breakpoint
CREATE POLICY "business_memberships_select" ON "business_memberships" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
        user_id = app.current_user_id()
        OR app.has_permission(business_id, branch_id, 'member:read')
        OR app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "business_memberships_insert" ON "business_memberships" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
        app.is_platform_user()
        OR (
          is_owner = true
          AND role_id IS NULL
          AND branch_id IS NULL
          AND user_id = app.current_user_id()
          AND business_id = app.current_business_id()
          AND EXISTS (
            SELECT 1
            FROM owner_redemptions r
            WHERE r.business_id = business_memberships.business_id
              AND r.email_normalized = NULLIF(current_setting('app.registration_email', true), '')
              AND r.token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
              AND r.consumed_at IS NULL
              AND r.revoked_at IS NULL
              AND r.expires_at > now()
          )
        )
      );--> statement-breakpoint
CREATE POLICY "business_memberships_update" ON "business_memberships" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (app.is_platform_user()) WITH CHECK (app.is_platform_user());--> statement-breakpoint
CREATE POLICY "business_memberships_owner_row_immutable" ON "business_memberships" AS RESTRICTIVE FOR UPDATE TO "fortis_app" USING (
        is_owner = false
      ) WITH CHECK (
        is_owner = false
      );--> statement-breakpoint
CREATE POLICY "invitations_select" ON "invitations" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
        app.is_platform_user() OR (business_id IS NOT NULL AND app.has_permission(business_id, branch_id, 'member:read'))
      );--> statement-breakpoint
CREATE POLICY "invitations_insert" ON "invitations" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
        app.is_platform_admin()
        AND invitation_type = 'platform_user'
        AND invited_by_platform_user_id = app.current_platform_user_id()
      );--> statement-breakpoint
CREATE POLICY "invitations_update" ON "invitations" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
        app.is_platform_admin() AND invitation_type = 'platform_user'
      ) WITH CHECK (
        app.is_platform_admin() AND invitation_type = 'platform_user'
      );--> statement-breakpoint
CREATE POLICY "invitations_delete" ON "invitations" AS PERMISSIVE FOR DELETE TO "fortis_app" USING (
        app.is_platform_admin() AND invitation_type = 'platform_user'
      );--> statement-breakpoint
CREATE POLICY "platform_users_select" ON "platform_users" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
        id = app.current_platform_user_id() OR app.is_bootstrap_platform_user()
      );--> statement-breakpoint
CREATE POLICY "platform_users_insert" ON "platform_users" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
        app.is_bootstrap_platform_user()
      );--> statement-breakpoint
CREATE POLICY "platform_users_update" ON "platform_users" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
        id = app.current_platform_user_id() OR app.is_bootstrap_platform_user()
      ) WITH CHECK (
        id = app.current_platform_user_id() OR app.is_bootstrap_platform_user()
      );--> statement-breakpoint
CREATE POLICY "platform_users_delete" ON "platform_users" AS PERMISSIVE FOR DELETE TO "fortis_app" USING (
        app.is_bootstrap_platform_user()
      );--> statement-breakpoint
CREATE POLICY "roles_select" ON "roles" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
        business_id IS NULL OR app.is_business_member(business_id) OR app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "permissions_select" ON "permissions" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (true);--> statement-breakpoint
CREATE POLICY "role_permissions_select" ON "role_permissions" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id));--> statement-breakpoint
CREATE POLICY "member_permission_overrides_select" ON "member_permission_overrides" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
        user_id = app.current_user_id()
        OR app.has_permission(business_id, NULL, 'member:read')
        OR app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "terminals_select" ON "terminals" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
        app.can_access_branch(business_id, branch_id) OR app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "terminals_insert" ON "terminals" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
        app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "terminals_update" ON "terminals" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
        app.is_platform_user()
      ) WITH CHECK (
        app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "terminals_owner_registration_activate" ON "terminals" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
        business_id = NULLIF(current_setting('app.terminal_activation_business_id', true), '')::uuid
        AND branch_id = NULLIF(current_setting('app.terminal_activation_branch_id', true), '')::uuid
        AND terminal_code = NULLIF(current_setting('app.terminal_activation_code', true), '')
        AND status = 'inactive'
        AND EXISTS (
          SELECT 1 FROM owner_redemptions r
          WHERE r.business_id = terminals.business_id
            AND r.token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
            AND r.consumed_at IS NULL AND r.revoked_at IS NULL AND r.expires_at > now()
        )
      ) WITH CHECK (
        business_id = NULLIF(current_setting('app.terminal_activation_business_id', true), '')::uuid
        AND branch_id = NULLIF(current_setting('app.terminal_activation_branch_id', true), '')::uuid
        AND terminal_code = NULLIF(current_setting('app.terminal_activation_code', true), '')
        AND status = 'active'
      );--> statement-breakpoint
CREATE POLICY "terminals_owner_activate" ON "terminals" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
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
CREATE POLICY "users_insert" ON "users" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
        EXISTS (
          SELECT 1 FROM owner_redemptions r
          WHERE r.email_normalized = users.email_normalized
            AND r.token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
            AND r.consumed_at IS NULL
            AND r.revoked_at IS NULL
            AND r.expires_at > now()
        )
        OR app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "users_select" ON "users" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
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
      );--> statement-breakpoint
CREATE POLICY "users_update" ON "users" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
        id = app.current_user_id() OR app.is_platform_user()
      ) WITH CHECK (
        id = app.current_user_id() OR app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "sessions_select_own" ON "sessions" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
        (user_id IS NOT NULL AND user_id = app.current_user_id())
        OR (platform_user_id IS NOT NULL
            AND platform_user_id = app.current_platform_user_id())
      );--> statement-breakpoint
CREATE POLICY "access_logs_select" ON "access_logs" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
        user_id = app.current_user_id()
        OR (business_id IS NOT NULL AND app.has_permission(business_id, NULL, 'audit:read'))
        OR app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "access_logs_insert" ON "access_logs" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
        business_id IS NULL OR app.is_business_member(business_id) OR app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "audit_logs_select" ON "audit_logs" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
        app.has_permission(business_id, NULL, 'audit:read') OR app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "audit_logs_insert" ON "audit_logs" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
        app.is_business_member(business_id) OR app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "platform_audit_logs_select" ON "platform_audit_logs" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
        app.is_platform_user()
      );--> statement-breakpoint
CREATE POLICY "platform_audit_logs_insert" ON "platform_audit_logs" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
        app.is_platform_user()
      );