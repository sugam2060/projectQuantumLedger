ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "users_self_or_platform_access_policy" ON "users" AS PERMISSIVE FOR ALL TO public USING (
      id = NULLIF(current_setting('app.current_user_id', true), '')::uuid 
      OR current_setting('app.is_platform_support', true) = 'true'
    ) WITH CHECK (
      id = NULLIF(current_setting('app.current_user_id', true), '')::uuid 
      OR current_setting('app.is_platform_support', true) = 'true'
    );