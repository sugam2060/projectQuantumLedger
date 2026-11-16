ALTER TABLE "invitations" ALTER COLUMN "business_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "role_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "invitation_type" text DEFAULT 'business_user' NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "invitee_name" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_type_chk" CHECK (invitation_type IN ('business_user', 'platform_user'));--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_target_chk" CHECK ((invitation_type = 'business_user' AND business_id IS NOT NULL AND role_id IS NOT NULL) OR (invitation_type = 'platform_user' AND business_id IS NULL AND role_id IS NULL AND branch_id IS NULL AND invitee_name IS NOT NULL AND btrim(invitee_name) <> '' AND invited_by_platform_user_id IS NOT NULL));--> statement-breakpoint
DROP INDEX "invitations_one_open_per_email_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_one_open_per_email_uq" ON "invitations" USING btree ("business_id", "email_normalized") WHERE invitation_type = 'business_user' AND consumed_at IS NULL AND revoked_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_user_invitations_one_open_per_email_uq" ON "invitations" USING btree ("email_normalized") WHERE invitation_type = 'platform_user' AND consumed_at IS NULL AND revoked_at IS NULL;--> statement-breakpoint
ALTER TABLE "mail_outbox" ALTER COLUMN "business_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_outbox" ALTER COLUMN "request_id" DROP NOT NULL;--> statement-breakpoint
ALTER POLICY "users_insert" ON "users" TO fortis_app WITH CHECK (
            EXISTS (
                SELECT 1 FROM invitations
                WHERE email_normalized = "users"."email_normalized"
                AND invitation_type = 'business_user'
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
        );
