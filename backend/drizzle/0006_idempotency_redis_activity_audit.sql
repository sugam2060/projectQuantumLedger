DROP TABLE IF EXISTS "api_idempotency";--> statement-breakpoint
ALTER TABLE "access_logs" ADD COLUMN "http_method" text;--> statement-breakpoint
ALTER TABLE "access_logs" ADD COLUMN "endpoint_path" text;--> statement-breakpoint
ALTER TABLE "access_logs" ADD COLUMN "response_status" integer;--> statement-breakpoint
ALTER TABLE "access_logs" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "access_logs" ADD COLUMN "client_type" text;--> statement-breakpoint
ALTER TABLE "access_logs" ADD COLUMN "terminal_id" uuid;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD COLUMN "http_method" text;--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD COLUMN "endpoint_path" text;--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD COLUMN "response_status" integer;--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD COLUMN "correlation_id" text;--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD COLUMN "client_type" text;--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD COLUMN "ip_address" text;--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD COLUMN "user_agent" text;
