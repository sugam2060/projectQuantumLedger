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
CREATE TABLE "api_idempotency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_idempotency" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mail_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_outbox_status_chk" CHECK (status IN ('pending', 'processing', 'sent')),
	CONSTRAINT "mail_outbox_attempts_chk" CHECK (attempts >= 0)
);
--> statement-breakpoint
ALTER TABLE "mail_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_user_id" uuid NOT NULL,
	"business_id" uuid,
	"request_id" uuid,
	"action" text NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "business_memberships" ALTER COLUMN "role_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "business_provisioning_requests" ADD COLUMN "provisioned_business_id" uuid;--> statement-breakpoint
ALTER TABLE "owner_redemptions" ADD CONSTRAINT "owner_redemptions_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_redemptions" ADD CONSTRAINT "owner_redemptions_request_id_business_provisioning_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."business_provisioning_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_redemptions" ADD CONSTRAINT "owner_redemptions_created_by_platform_user_id_platform_users_id_fk" FOREIGN KEY ("created_by_platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_redemptions" ADD CONSTRAINT "owner_redemptions_consumed_by_user_id_users_id_fk" FOREIGN KEY ("consumed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_idempotency" ADD CONSTRAINT "api_idempotency_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_request_id_business_provisioning_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."business_provisioning_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "owner_redemptions_token_hash_uq" ON "owner_redemptions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_redemptions_request_uq" ON "owner_redemptions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "owner_redemptions_business_email_idx" ON "owner_redemptions" USING btree ("business_id","email_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "api_idempotency_actor_operation_key_uq" ON "api_idempotency" USING btree ("platform_user_id","operation","idempotency_key");--> statement-breakpoint
CREATE INDEX "api_idempotency_expires_idx" ON "api_idempotency" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "mail_outbox_ready_idx" ON "mail_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "platform_audit_logs_actor_created_idx" ON "platform_audit_logs" USING btree ("platform_user_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_logs_request_idx" ON "platform_audit_logs" USING btree ("request_id");--> statement-breakpoint
ALTER TABLE "business_provisioning_requests" ADD CONSTRAINT "business_provisioning_requests_provisioned_business_id_business_id_fk" FOREIGN KEY ("provisioned_business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_provisioning_requests_provisioned_business_uq" ON "business_provisioning_requests" USING btree ("provisioned_business_id") WHERE provisioned_business_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_role_required_chk" CHECK (is_owner = true OR role_id IS NOT NULL);--> statement-breakpoint
CREATE POLICY "owner_redemptions_select" ON "owner_redemptions" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
        app_is_platform() = true
        OR token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
      );--> statement-breakpoint
CREATE POLICY "owner_redemptions_insert" ON "owner_redemptions" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (app_is_platform() = true);--> statement-breakpoint
CREATE POLICY "owner_redemptions_update" ON "owner_redemptions" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
        app_is_platform() = true
        OR token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
      ) WITH CHECK (
        app_is_platform() = true
        OR token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
      );--> statement-breakpoint
CREATE POLICY "api_idempotency_select" ON "api_idempotency" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (app_is_platform() = true);--> statement-breakpoint
CREATE POLICY "api_idempotency_insert" ON "api_idempotency" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (app_is_platform() = true);--> statement-breakpoint
CREATE POLICY "mail_outbox_select" ON "mail_outbox" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (app_is_platform() = true);--> statement-breakpoint
CREATE POLICY "mail_outbox_insert" ON "mail_outbox" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (app_is_platform() = true);--> statement-breakpoint
CREATE POLICY "mail_outbox_update" ON "mail_outbox" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (app_is_platform() = true) WITH CHECK (app_is_platform() = true);--> statement-breakpoint
CREATE POLICY "platform_audit_logs_select" ON "platform_audit_logs" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (app_is_platform() = true);--> statement-breakpoint
CREATE POLICY "platform_audit_logs_insert" ON "platform_audit_logs" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (app_is_platform() = true);--> statement-breakpoint
ALTER POLICY "users_insert" ON "users" TO fortis_app WITH CHECK (
            EXISTS (
                SELECT 1 FROM invitations 
                WHERE email_normalized = "users"."email_normalized"
                AND consumed_at IS NULL
                AND revoked_at IS NULL
            )
            OR EXISTS (
                SELECT 1 FROM owner_redemptions r
                WHERE r.email_normalized = users.email_normalized
                  AND r.token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
                  AND r.consumed_at IS NULL
                  AND r.revoked_at IS NULL
                  AND r.expires_at > now()
            )
            OR public.app_is_platform() = true
        );--> statement-breakpoint
ALTER POLICY "users_select" ON "users" TO fortis_app USING (
            id = public.app_user_id()
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
                SELECT 1 FROM business_memberships m1
                JOIN business_memberships m2 ON m1.business_id = m2.business_id
                WHERE m1.user_id = public.app_user_id() 
                  AND m2.user_id = users.id 
                  AND m1.business_id = public.app_business_id()
                  AND m1.is_active = true
                  AND m2.is_active = true
            )
            OR public.app_is_platform() = true
        );