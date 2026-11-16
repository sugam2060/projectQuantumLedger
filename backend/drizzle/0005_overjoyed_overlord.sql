ALTER TABLE "api_idempotency" ADD COLUMN "request_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "api_idempotency" ADD COLUMN "business_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "business_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "request_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "api_idempotency" ADD CONSTRAINT "api_idempotency_request_id_business_provisioning_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."business_provisioning_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_idempotency" ADD CONSTRAINT "api_idempotency_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_business_id_business_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."business"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD CONSTRAINT "mail_outbox_request_id_business_provisioning_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."business_provisioning_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_idempotency_request_uq" ON "api_idempotency" USING btree ("request_id");