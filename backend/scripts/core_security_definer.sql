-- Remove the former login lookup function now that login uses the
-- transaction-scoped RLS policy on platform_users directly.
DROP FUNCTION IF EXISTS public.lookup_platform_user_for_auth(TEXT);

CREATE OR REPLACE FUNCTION public.redeem_invitation_and_register(
    p_token_hash TEXT,
    p_name TEXT,
    p_password_hash TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_invitation public.invitations%ROWTYPE;
    v_user_id UUID;
BEGIN
    UPDATE public.invitations
    SET consumed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE token_hash = p_token_hash
      AND consumed_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > pg_catalog.now()
    RETURNING * INTO v_invitation;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or expired invitation token.';
    END IF;

    INSERT INTO public.users (email_normalized, password_hash, name, status)
    VALUES (v_invitation.email_normalized, p_password_hash, p_name, 'active')
    RETURNING id INTO v_user_id;

    INSERT INTO public.business_memberships (business_id, user_id, role_id, branch_id, is_active)
    VALUES (v_invitation.business_id, v_user_id, v_invitation.role_id, v_invitation.branch_id, true);

    RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_invitation_and_register(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation_and_register(TEXT, TEXT, TEXT) TO fortis_app;
