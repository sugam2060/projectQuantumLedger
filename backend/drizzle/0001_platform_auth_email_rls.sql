DROP POLICY IF EXISTS "platform_users_select" ON "platform_users";--> statement-breakpoint
CREATE POLICY "platform_users_select" ON "platform_users" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
  id = app_platform_user_id()
  OR email_normalized = NULLIF(current_setting('app.platform_auth_email', true), '')
);--> statement-breakpoint
