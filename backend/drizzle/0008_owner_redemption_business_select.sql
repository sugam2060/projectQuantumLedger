ALTER POLICY "business_select" ON "business" TO fortis_app USING (
  (id = app_business_id() AND app_is_owner() = true)
  OR app_is_platform() = true
  OR EXISTS (
    SELECT 1
    FROM owner_redemptions r
    WHERE r.business_id = business.id
      AND r.email_normalized = NULLIF(current_setting('app.registration_email', true), '')
      AND r.token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
      AND r.consumed_at IS NULL
      AND r.revoked_at IS NULL
      AND r.expires_at > now()
  )
);
