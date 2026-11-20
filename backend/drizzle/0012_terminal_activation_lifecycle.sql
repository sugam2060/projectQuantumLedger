ALTER TABLE "terminals" ALTER COLUMN "status" SET DEFAULT 'inactive';--> statement-breakpoint
DROP POLICY "terminals_select" ON "terminals";--> statement-breakpoint
CREATE POLICY "terminals_select" ON "terminals" AS PERMISSIVE FOR SELECT TO "fortis_app" USING (
  (business_id = app_business_id() AND (app_is_owner() = true OR app_branch_id() IS NULL OR branch_id = app_branch_id()))
  OR app_is_platform() = true
);--> statement-breakpoint
CREATE POLICY "terminals_owner_registration_activate" ON "terminals" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
  business_id = NULLIF(current_setting('app.terminal_activation_business_id', true), '')::uuid
  AND branch_id = NULLIF(current_setting('app.terminal_activation_branch_id', true), '')::uuid
  AND terminal_code = NULLIF(current_setting('app.terminal_activation_code', true), '')
  AND status = 'inactive'
  AND EXISTS (
    SELECT 1 FROM owner_redemptions r
    WHERE r.business_id = terminals.business_id
      AND r.token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
      AND r.consumed_at IS NULL AND r.revoked_at IS NULL AND r.expires_at > now()
  )
) WITH CHECK (
  business_id = NULLIF(current_setting('app.terminal_activation_business_id', true), '')::uuid
  AND branch_id = NULLIF(current_setting('app.terminal_activation_branch_id', true), '')::uuid
  AND terminal_code = NULLIF(current_setting('app.terminal_activation_code', true), '')
  AND status = 'active'
);--> statement-breakpoint
CREATE POLICY "terminals_owner_activate" ON "terminals" AS PERMISSIVE FOR UPDATE TO "fortis_app" USING (
  business_id = app_business_id()
  AND business_id = NULLIF(current_setting('app.terminal_activation_business_id', true), '')::uuid
  AND branch_id = NULLIF(current_setting('app.terminal_activation_branch_id', true), '')::uuid
  AND terminal_code = NULLIF(current_setting('app.terminal_activation_code', true), '')
  AND status = 'inactive'
  AND app_is_owner() = true
) WITH CHECK (
  business_id = app_business_id()
  AND business_id = NULLIF(current_setting('app.terminal_activation_business_id', true), '')::uuid
  AND branch_id = NULLIF(current_setting('app.terminal_activation_branch_id', true), '')::uuid
  AND terminal_code = NULLIF(current_setting('app.terminal_activation_code', true), '')
  AND status = 'active'
  AND app_is_owner() = true
);
