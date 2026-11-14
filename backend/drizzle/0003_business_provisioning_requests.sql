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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_provisioning_requests_status_chk" CHECK (status IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "business_provisioning_requests_legal_name_chk" CHECK (btrim(legal_name) <> ''),
	CONSTRAINT "business_provisioning_requests_display_name_chk" CHECK (btrim(display_name) <> '')
);--> statement-breakpoint
ALTER TABLE "business_provisioning_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "address_details" jsonb;--> statement-breakpoint
ALTER TABLE "business" ADD COLUMN "documents" jsonb;--> statement-breakpoint
ALTER TABLE "business_provisioning_requests" ADD CONSTRAINT "business_provisioning_requests_reviewed_by_platform_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_provisioning_requests_status_created_idx" ON "business_provisioning_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "business_provisioning_requests_contact_email_idx" ON "business_provisioning_requests" USING btree ("primary_contact_email");--> statement-breakpoint
CREATE POLICY "business_provisioning_requests_public_insert" ON "business_provisioning_requests" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "business_provisioning_requests_platform_select" ON "business_provisioning_requests" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (app_is_platform() = true);--> statement-breakpoint
CREATE POLICY "business_provisioning_requests_platform_update" ON "business_provisioning_requests" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (app_is_platform() = true) WITH CHECK (app_is_platform() = true);--> statement-breakpoint
ALTER POLICY "platform_users_select" ON "platform_users" TO fortis_app USING (
            id = app_platform_user_id()
            OR email_normalized = NULLIF(current_setting('app.platform_auth_email', true), '')
        );--> statement-breakpoint
