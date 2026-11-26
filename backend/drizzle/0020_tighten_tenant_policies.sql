ALTER POLICY "business_select" ON "business" TO fortis_app USING (
        app.is_business_owner(id)
        OR app.is_platform_user()
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
      );--> statement-breakpoint
ALTER POLICY "business_memberships_insert" ON "business_memberships" TO fortis_app WITH CHECK (
        app.is_platform_user()
        OR (
          is_owner = true
          AND role_id IS NULL
          AND branch_id IS NULL
          AND user_id = app.current_user_id()
          AND business_id = app.current_business_id()
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
      );--> statement-breakpoint
ALTER POLICY "platform_users_select" ON "platform_users" TO fortis_app USING (
        id = app.current_platform_user_id() OR app.is_bootstrap_platform_user()
      );--> statement-breakpoint
ALTER POLICY "users_select" ON "users" TO fortis_app USING (
        id = app.current_user_id()
        OR (
          email_normalized = NULLIF(current_setting('app.registration_email', true), '')
          AND EXISTS (
          SELECT 1 FROM owner_redemptions r
          WHERE r.email_normalized = users.email_normalized
            AND r.token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
            AND r.consumed_at IS NULL
            AND r.revoked_at IS NULL
            AND r.expires_at > now()
        )
        )
        OR EXISTS (
          SELECT 1 FROM business_memberships m
          WHERE m.user_id = users.id
            AND m.is_active
            AND app.is_business_member(m.business_id)
        )
        OR app.is_platform_user()
      );