ALTER POLICY "invitations_insert" ON "invitations" TO fortis_app WITH CHECK (
        app.is_platform_admin()
        AND invitation_type = 'platform_user'
        AND invited_by_platform_user_id = app.current_platform_user_id()
      );--> statement-breakpoint
ALTER POLICY "invitations_update" ON "invitations" TO fortis_app USING (
        app.is_platform_admin() AND invitation_type = 'platform_user'
      ) WITH CHECK (
        app.is_platform_admin() AND invitation_type = 'platform_user'
      );--> statement-breakpoint
ALTER POLICY "invitations_delete" ON "invitations" TO fortis_app USING (
        app.is_platform_admin() AND invitation_type = 'platform_user'
      );