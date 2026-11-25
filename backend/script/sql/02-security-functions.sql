-- 02: SECURITY DEFINER functions. Applied before the Drizzle migrations so policies
-- can reference them; written in plpgsql because plpgsql bodies are not checked
-- against tables at creation time (the tables may not exist yet on a fresh DB).
-- Idempotent (CREATE OR REPLACE), re-run on every migration.
--
-- Rules for every function here:
--   * SET search_path = pg_catalog, pg_temp, and every relation schema-qualified,
--     so a caller cannot shadow a table or operator.
--   * They run as the table owner and therefore bypass RLS; each one returns
--     only the minimum the caller needs.
--   * EXECUTE is granted to fortis_app only (03-app-grant-least-privilege.sql).

-- ---------------------------------------------------------------------------
-- Membership predicates used by RLS policies. Being SECURITY DEFINER they read
-- business_memberships without recursing into its own policies.
-- ---------------------------------------------------------------------------

-- The current request belongs to an active platform user (Fortis staff).
CREATE OR REPLACE FUNCTION app.is_platform_user()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
      FROM public.platform_users p
     WHERE p.id = app.current_platform_user_id()
       AND p.status = 'active'
  );
END;
$$;

-- The current user has an active membership in the business.
CREATE OR REPLACE FUNCTION app.is_business_member(p_business_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
      FROM public.business_memberships m
      JOIN public.users u ON u.id = m.user_id
     WHERE m.business_id = p_business_id
       AND m.user_id = app.current_user_id()
       AND m.is_active
       AND u.status = 'active'
  );
END;
$$;

-- The current user is the active owner of the business.
CREATE OR REPLACE FUNCTION app.is_business_owner(p_business_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
      FROM public.business_memberships m
      JOIN public.users u ON u.id = m.user_id
     WHERE m.business_id = p_business_id
       AND m.user_id = app.current_user_id()
       AND m.is_active
       AND m.is_owner
       AND u.status = 'active'
  );
END;
$$;

-- The current user may see data of this branch: the owner, a business-wide
-- member (branch_id IS NULL) or a member assigned to that branch.
CREATE OR REPLACE FUNCTION app.can_access_branch(
  p_business_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
      FROM public.business_memberships m
      JOIN public.users u ON u.id = m.user_id
     WHERE m.business_id = p_business_id
       AND m.user_id = app.current_user_id()
       AND m.is_active
       AND u.status = 'active'
       AND (m.is_owner OR m.branch_id IS NULL OR m.branch_id = p_branch_id)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Pre-authentication lookups. Sign-in happens before any user context exists,
-- so RLS would hide these rows; these functions expose exactly one account.
-- ---------------------------------------------------------------------------

-- Business user by email (case-insensitive). Includes the password hash so the
-- API can verify it; the runtime role cannot read users.password_hash otherwise.
CREATE OR REPLACE FUNCTION app.auth_find_user_by_email(p_email text)
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  password_hash text,
  status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT u.id, u.email_normalized, u.name, u.password_hash, u.status
      FROM public.users u
     WHERE u.email_normalized = pg_catalog.lower(pg_catalog.btrim(p_email))
     LIMIT 1;
END;
$$;

-- Business user by id (refresh and /me re-check that the account is active).
CREATE OR REPLACE FUNCTION app.auth_find_user_by_id(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  password_hash text,
  status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT u.id, u.email_normalized, u.name, u.password_hash, u.status
      FROM public.users u
     WHERE u.id = p_user_id;
END;
$$;

-- Platform (Fortis staff) user by email.
CREATE OR REPLACE FUNCTION app.auth_find_platform_user_by_email(p_email text)
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  password_hash text,
  status text,
  is_bootstrap boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT p.id, p.email_normalized, p.name, p.password_hash, p.status,
           p.is_bootstrap
      FROM public.platform_users p
     WHERE p.email_normalized = pg_catalog.lower(pg_catalog.btrim(p_email))
     LIMIT 1;
END;
$$;

-- Platform user by id.
CREATE OR REPLACE FUNCTION app.auth_find_platform_user_by_id(p_platform_user_id uuid)
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  password_hash text,
  status text,
  is_bootstrap boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT p.id, p.email_normalized, p.name, p.password_hash, p.status,
           p.is_bootstrap
      FROM public.platform_users p
     WHERE p.id = p_platform_user_id;
END;
$$;

-- Active memberships of a user (at most one today) with the role summary.
CREATE OR REPLACE FUNCTION app.auth_list_active_memberships(p_user_id uuid)
RETURNS TABLE (
  membership_id uuid,
  business_id uuid,
  branch_id uuid,
  is_owner boolean,
  role_id uuid,
  role_name text,
  role_version integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT m.id, m.business_id, m.branch_id, m.is_owner, m.role_id,
           r.name, r.version
      FROM public.business_memberships m
      JOIN public.business b ON b.id = m.business_id
      LEFT JOIN public.roles r ON r.id = m.role_id
     WHERE m.user_id = p_user_id
       AND m.is_active
       AND b.is_active;
END;
$$;

-- An active terminal whose branch belongs to the same business.
CREATE OR REPLACE FUNCTION app.auth_find_active_terminal(p_terminal_id uuid)
RETURNS TABLE (
  id uuid,
  business_id uuid,
  branch_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT t.id, t.business_id, t.branch_id
      FROM public.terminals t
      JOIN public.branches br
        ON br.id = t.branch_id AND br.business_id = t.business_id
     WHERE t.id = p_terminal_id
       AND t.status = 'active'
       AND br.is_active;
END;
$$;

-- The unused invitation/registration function from the old setup.
DROP FUNCTION IF EXISTS public.redeem_invitation_and_register(text, text, text);
