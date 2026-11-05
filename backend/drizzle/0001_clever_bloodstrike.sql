CREATE TABLE "business_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"branch_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_memberships_user_business_uq" ON "business_memberships" USING btree ("user_id","business_id");--> statement-breakpoint
CREATE INDEX "access_logs_business_idx" ON "access_logs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "access_logs_user_idx" ON "access_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_business_idx" ON "audit_logs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "audit_logs_branch_idx" ON "audit_logs" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "audit_logs_table_record_idx" ON "audit_logs" USING btree ("table_name","record_id");--> statement-breakpoint
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
CREATE POLICY "users_select" ON "users" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
            id = app_user_id()
            OR EXISTS (
                SELECT 1 FROM business_memberships m
                WHERE m.user_id = users.id AND m.business_id = app_business_id()
            )
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.redeem_invitation_and_register(
    p_token_hash TEXT,
    p_name TEXT,
    p_password_hash TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_invitation public.invitations%ROWTYPE;
    v_user_id UUID;
BEGIN
    UPDATE public.invitations
    SET consumed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE token_hash = p_token_hash
      AND consumed_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > pg_catalog.now()
    RETURNING * INTO v_invitation;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or expired invitation token.';
    END IF;

    INSERT INTO public.users (email_normalized, password_hash, name, status)
    VALUES (v_invitation.email_normalized, p_password_hash, p_name, 'active')
    RETURNING id INTO v_user_id;

    INSERT INTO public.business_memberships (business_id, user_id, role_id, branch_id, is_active)
    VALUES (v_invitation.business_id, v_user_id, v_invitation.role_id, v_invitation.branch_id, true);

    RETURN v_user_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.redeem_invitation_and_register(TEXT, TEXT, TEXT) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.redeem_invitation_and_register(TEXT, TEXT, TEXT) TO fortis_app;