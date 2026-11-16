ALTER POLICY "business_memberships_insert" ON "business_memberships" TO fortis_app WITH CHECK (
  (business_id = app_business_id() AND app_is_owner() = true)
  OR app_is_platform() = true
  OR (
    is_owner = true
    AND role_id IS NULL
    AND branch_id IS NULL
    AND user_id = app_user_id()
    AND business_id = app_business_id()
    AND EXISTS (
      SELECT 1
      FROM owner_redemptions r
      WHERE r.business_id = business_memberships.business_id
        AND r.email_normalized = NULLIF(current_setting('app.registration_email', true), '')
        AND r.token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
        AND r.consumed_at IS NULL
        AND r.revoked_at IS NULL
        AND r.expires_at > now()
    )
  )
);
