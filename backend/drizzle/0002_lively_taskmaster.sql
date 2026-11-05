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
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "terminals_branch_code_uq" ON "terminals" USING btree ("branch_id","terminal_code");--> statement-breakpoint
CREATE POLICY "terminals_select" ON "terminals" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
            business_id = app_business_id()
            AND (app_branch_id() IS NULL OR branch_id = app_branch_id())
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "terminals_insert" ON "terminals" AS PERMISSIVE FOR INSERT TO "fortis_app" WITH CHECK (
            business_id = app_business_id()
            OR app_is_platform() = true
        );--> statement-breakpoint
CREATE POLICY "terminals_update" ON "terminals" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
            business_id = app_business_id()
            OR app_is_platform() = true
        ) WITH CHECK (
            business_id = app_business_id()
            OR app_is_platform() = true
        );