DROP POLICY "mail_outbox_select" ON "mail_outbox" CASCADE;--> statement-breakpoint
DROP POLICY "mail_outbox_insert" ON "mail_outbox" CASCADE;--> statement-breakpoint
DROP POLICY "mail_outbox_update" ON "mail_outbox" CASCADE;--> statement-breakpoint
DROP TABLE "mail_outbox" CASCADE;