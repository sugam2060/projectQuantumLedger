CREATE POLICY "business_memberships_owner_row_immutable" ON "business_memberships" AS RESTRICTIVE FOR UPDATE TO "fortis_app" USING (
        is_owner = false
      ) WITH CHECK (
        is_owner = false
      );--> statement-breakpoint
ALTER POLICY "branches_select" ON "branches" TO fortis_app USING (
        app.can_access_branch(business_id, id) OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "branches_insert" ON "branches" TO fortis_app WITH CHECK (
        app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "branches_update" ON "branches" TO fortis_app USING (
        app.is_business_owner(business_id) OR app.is_platform_user()
      ) WITH CHECK (
        app.is_business_owner(business_id) OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "business_select" ON "business" TO fortis_app USING (
        app.is_business_member(id)
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
ALTER POLICY "business_update" ON "business" TO fortis_app USING (
        app.is_business_owner(id) OR app.is_platform_user()
      ) WITH CHECK (
        app.is_business_owner(id) OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "business_insert" ON "business" TO fortis_app WITH CHECK (
        app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "business_provisioning_requests_platform_select" ON "business_provisioning_requests" TO fortis_app USING (
        app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "business_provisioning_requests_platform_update" ON "business_provisioning_requests" TO fortis_app USING (
        app.is_platform_user()
      ) WITH CHECK (
        app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "owner_redemptions_select" ON "owner_redemptions" TO fortis_app USING (
        app.is_platform_user() OR token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
      );--> statement-breakpoint
ALTER POLICY "owner_redemptions_insert" ON "owner_redemptions" TO fortis_app WITH CHECK (
        app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "owner_redemptions_update" ON "owner_redemptions" TO fortis_app USING (
        app.is_platform_user() OR token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
      ) WITH CHECK (
        app.is_platform_user() OR token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
      );--> statement-breakpoint
ALTER POLICY "business_memberships_select" ON "business_memberships" TO fortis_app USING (
        user_id = app.current_user_id() OR app.is_business_member(business_id) OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "business_memberships_insert" ON "business_memberships" TO fortis_app WITH CHECK (
        app.is_business_owner(business_id)
        OR app.is_platform_user()
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
ALTER POLICY "business_memberships_update" ON "business_memberships" TO fortis_app USING (
        app.is_business_owner(business_id) OR app.is_platform_user()
      ) WITH CHECK (
        app.is_business_owner(business_id) OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "endpoint_role_access_select" ON "endpoint_role_access" TO fortis_app USING (
        app.is_business_member(business_id) OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "endpoint_role_access_insert" ON "endpoint_role_access" TO fortis_app WITH CHECK (
        (
          app.is_business_owner(business_id)
          AND EXISTS (
            SELECT 1 FROM roles
            WHERE roles.id = endpoint_role_access.role_id
              AND (roles.business_id = endpoint_role_access.business_id OR roles.business_id IS NULL)
          )
        )
        OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "endpoint_role_access_delete" ON "endpoint_role_access" TO fortis_app USING (
        app.is_business_owner(business_id) OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "invitations_select" ON "invitations" TO fortis_app USING (
        app.is_platform_user() OR (business_id IS NOT NULL AND app.is_business_owner(business_id))
      );--> statement-breakpoint
ALTER POLICY "invitations_insert" ON "invitations" TO fortis_app WITH CHECK (
        app.is_platform_user() OR (business_id IS NOT NULL AND app.is_business_owner(business_id))
      );--> statement-breakpoint
ALTER POLICY "invitations_update" ON "invitations" TO fortis_app USING (
        app.is_platform_user() OR (business_id IS NOT NULL AND app.is_business_owner(business_id))
      ) WITH CHECK (
        app.is_platform_user() OR (business_id IS NOT NULL AND app.is_business_owner(business_id))
      );--> statement-breakpoint
ALTER POLICY "invitations_delete" ON "invitations" TO fortis_app USING (
        app.is_platform_user() OR (business_id IS NOT NULL AND app.is_business_owner(business_id))
      );--> statement-breakpoint
ALTER POLICY "platform_users_select" ON "platform_users" TO fortis_app USING (
        id = app.current_platform_user_id() OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "platform_users_insert" ON "platform_users" TO fortis_app WITH CHECK (
        app.is_bootstrap_platform_user()
      );--> statement-breakpoint
ALTER POLICY "platform_users_update" ON "platform_users" TO fortis_app USING (
        id = app.current_platform_user_id() OR app.is_bootstrap_platform_user()
      ) WITH CHECK (
        id = app.current_platform_user_id() OR app.is_bootstrap_platform_user()
      );--> statement-breakpoint
ALTER POLICY "platform_users_delete" ON "platform_users" TO fortis_app USING (
        app.is_bootstrap_platform_user()
      );--> statement-breakpoint
ALTER POLICY "roles_select" ON "roles" TO fortis_app USING (
        business_id IS NULL OR app.is_business_member(business_id) OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "roles_insert" ON "roles" TO fortis_app WITH CHECK (
        (business_id IS NOT NULL AND app.is_business_owner(business_id)) OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "roles_update" ON "roles" TO fortis_app USING (
        (business_id IS NOT NULL AND app.is_business_owner(business_id)) OR app.is_platform_user()
      ) WITH CHECK (
        (business_id IS NOT NULL AND app.is_business_owner(business_id)) OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "terminals_select" ON "terminals" TO fortis_app USING (
        app.can_access_branch(business_id, branch_id) OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "terminals_insert" ON "terminals" TO fortis_app WITH CHECK (
        app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "terminals_update" ON "terminals" TO fortis_app USING (
        app.is_platform_user()
      ) WITH CHECK (
        app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "terminals_owner_activate" ON "terminals" TO fortis_app USING (
        app.is_business_owner(business_id)
        AND business_id = NULLIF(current_setting('app.terminal_activation_business_id', true), '')::uuid
        AND branch_id = NULLIF(current_setting('app.terminal_activation_branch_id', true), '')::uuid
        AND terminal_code = NULLIF(current_setting('app.terminal_activation_code', true), '')
        AND status = 'inactive'
      ) WITH CHECK (
        app.is_business_owner(business_id)
        AND business_id = NULLIF(current_setting('app.terminal_activation_business_id', true), '')::uuid
        AND branch_id = NULLIF(current_setting('app.terminal_activation_branch_id', true), '')::uuid
        AND terminal_code = NULLIF(current_setting('app.terminal_activation_code', true), '')
        AND status = 'active'
      );--> statement-breakpoint
ALTER POLICY "users_insert" ON "users" TO fortis_app WITH CHECK (
        EXISTS (
          SELECT 1 FROM owner_redemptions r
          WHERE r.email_normalized = users.email_normalized
            AND r.token_hash = NULLIF(current_setting('app.owner_redemption_hash', true), '')
            AND r.consumed_at IS NULL
            AND r.revoked_at IS NULL
            AND r.expires_at > now()
        )
        OR app.is_platform_user()
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
            AND app.is_business_member(m.business_id)
        )
        OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "users_update" ON "users" TO fortis_app USING (
        id = app.current_user_id() OR app.is_platform_user()
      ) WITH CHECK (
        id = app.current_user_id() OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "access_logs_select" ON "access_logs" TO fortis_app USING (
        user_id = app.current_user_id()
        OR (business_id IS NOT NULL AND app.is_business_owner(business_id))
        OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "access_logs_insert" ON "access_logs" TO fortis_app WITH CHECK (
        business_id IS NULL OR app.is_business_member(business_id) OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "audit_logs_select" ON "audit_logs" TO fortis_app USING (
        app.is_business_owner(business_id) OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "audit_logs_insert" ON "audit_logs" TO fortis_app WITH CHECK (
        app.is_business_member(business_id) OR app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "platform_audit_logs_select" ON "platform_audit_logs" TO fortis_app USING (
        app.is_platform_user()
      );--> statement-breakpoint
ALTER POLICY "platform_audit_logs_insert" ON "platform_audit_logs" TO fortis_app WITH CHECK (
        app.is_platform_user()
      );