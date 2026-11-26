ALTER TABLE "roles" DROP CONSTRAINT "roles_key_chk";--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_key_chk" CHECK (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$');