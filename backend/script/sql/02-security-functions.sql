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

-- The current request belongs to an active bootstrap platform user (may manage
-- other platform users).
CREATE OR REPLACE FUNCTION app.is_bootstrap_platform_user()
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
       AND p.is_bootstrap
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

-- Business user by email (case-insensitive). Returns the password hash because
-- sign-in verifies it in the API (argon2id). At most one exact-email row; only
-- fortis_app may call it. Used only by the sign-in flow.
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

-- The current user's own account (refresh and /me re-check that it is still
-- active). Answers only for app.current_user_id() and never returns the hash.
DROP FUNCTION IF EXISTS app.auth_find_user_by_id(uuid);
CREATE OR REPLACE FUNCTION app.auth_find_user_by_id(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT u.id, u.email_normalized, u.name, u.status
      FROM public.users u
     WHERE u.id = p_user_id
       AND u.id = app.current_user_id();
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

-- The current platform user's own account. Answers only for
-- app.current_platform_user_id() and never returns the hash.
DROP FUNCTION IF EXISTS app.auth_find_platform_user_by_id(uuid);
CREATE OR REPLACE FUNCTION app.auth_find_platform_user_by_id(p_platform_user_id uuid)
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  status text,
  is_bootstrap boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT p.id, p.email_normalized, p.name, p.status, p.is_bootstrap
      FROM public.platform_users p
     WHERE p.id = p_platform_user_id
       AND p.id = app.current_platform_user_id();
END;
$$;

-- Active memberships of the current user (at most one today) with the role
-- summary. Answers only for app.current_user_id(): sign-in sets the context to
-- the account whose password was just verified.
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
       AND m.user_id = app.current_user_id()
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

-- ---------------------------------------------------------------------------
-- Refresh-token sessions. public.sessions has no write policies: these
-- functions are the only way to create, rotate or revoke a session. Tokens are
-- passed as their SHA-256 hex digest, never in plain text.
-- ---------------------------------------------------------------------------

-- Starts a session for the actor in the current request context (sign-in sets
-- app.user_id / app.platform_user_id after verifying the password).
CREATE OR REPLACE FUNCTION app.auth_create_session(
  p_user_id uuid,
  p_platform_user_id uuid,
  p_token_hash text,
  p_client_type text,
  p_terminal_id uuid,
  p_persistent boolean,
  p_user_agent text,
  p_ip text,
  p_expires_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF pg_catalog.num_nonnulls(p_user_id, p_platform_user_id) <> 1
     OR (p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM app.current_user_id())
     OR (p_platform_user_id IS NOT NULL
         AND p_platform_user_id IS DISTINCT FROM app.current_platform_user_id())
  THEN
    RAISE EXCEPTION 'session actor does not match the request context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.sessions (
    user_id, platform_user_id, refresh_token_hash, client_type, terminal_id,
    persistent, user_agent, ip, expires_at
  ) VALUES (
    p_user_id, p_platform_user_id, p_token_hash, p_client_type, p_terminal_id,
    p_persistent, p_user_agent, p_ip, p_expires_at
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Atomically swaps a refresh token for a new one. Outcomes:
--   rotated  old session revoked + rotated_at set; a new session returned
--   reuse    the token was already rotated (a stale copy was replayed): every
--            session of that actor is revoked
--   invalid  unknown, expired, revoked (logout / password change) or the account
--            is no longer active; nothing else is touched
CREATE OR REPLACE FUNCTION app.auth_rotate_session(
  p_old_hash text,
  p_new_hash text,
  p_user_agent text,
  p_ip text,
  p_persistent_ttl interval,
  p_session_ttl interval
)
RETURNS TABLE (
  outcome text,
  session_id uuid,
  user_id uuid,
  platform_user_id uuid,
  client_type text,
  terminal_id uuid,
  persistent boolean,
  expires_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_old record;
  v_active boolean;
  v_new_id uuid;
  v_expires timestamptz;
BEGIN
  SELECT * INTO v_old
    FROM public.sessions s
   WHERE s.refresh_token_hash = p_old_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid, NULL::uuid,
                        NULL::text, NULL::uuid, NULL::boolean, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_old.rotated_at IS NOT NULL THEN
    UPDATE public.sessions s
       SET revoked_at = pg_catalog.now()
     WHERE s.revoked_at IS NULL
       AND ((v_old.user_id IS NOT NULL AND s.user_id = v_old.user_id)
         OR (v_old.platform_user_id IS NOT NULL
             AND s.platform_user_id = v_old.platform_user_id));
    RETURN QUERY SELECT 'reuse'::text, NULL::uuid, v_old.user_id,
                        v_old.platform_user_id, v_old.client_type,
                        v_old.terminal_id, v_old.persistent, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_old.revoked_at IS NOT NULL OR v_old.expires_at <= pg_catalog.now() THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, v_old.user_id,
                        v_old.platform_user_id, v_old.client_type,
                        v_old.terminal_id, v_old.persistent, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_old.user_id IS NOT NULL THEN
    SELECT u.status = 'active' INTO v_active
      FROM public.users u WHERE u.id = v_old.user_id;
  ELSE
    SELECT p.status = 'active' INTO v_active
      FROM public.platform_users p WHERE p.id = v_old.platform_user_id;
  END IF;

  IF v_active IS NOT TRUE THEN
    UPDATE public.sessions s SET revoked_at = pg_catalog.now()
     WHERE s.id = v_old.id;
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, v_old.user_id,
                        v_old.platform_user_id, v_old.client_type,
                        v_old.terminal_id, v_old.persistent, NULL::timestamptz;
    RETURN;
  END IF;

  UPDATE public.sessions s
     SET revoked_at = pg_catalog.now(), rotated_at = pg_catalog.now()
   WHERE s.id = v_old.id;

  v_expires := pg_catalog.now()
    + CASE WHEN v_old.persistent THEN p_persistent_ttl ELSE p_session_ttl END;

  INSERT INTO public.sessions (
    user_id, platform_user_id, refresh_token_hash, client_type, terminal_id,
    persistent, user_agent, ip, expires_at
  ) VALUES (
    v_old.user_id, v_old.platform_user_id, p_new_hash, v_old.client_type,
    v_old.terminal_id, v_old.persistent, p_user_agent, p_ip, v_expires
  )
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT 'rotated'::text, v_new_id, v_old.user_id,
                      v_old.platform_user_id, v_old.client_type,
                      v_old.terminal_id, v_old.persistent, v_expires;
END;
$$;

-- Ends one session (logout). Possession of the refresh token is the proof, so no
-- request context is needed. Returns false when there was nothing to revoke.
CREATE OR REPLACE FUNCTION app.auth_revoke_session(p_token_hash text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE public.sessions s
     SET revoked_at = pg_catalog.now()
   WHERE s.refresh_token_hash = p_token_hash
     AND s.revoked_at IS NULL;
  RETURN FOUND;
END;
$$;

-- Ends every session of the actor in the current request context (logout-all,
-- password change, ended membership). Returns how many were revoked.
CREATE OR REPLACE FUNCTION app.auth_revoke_all_sessions(
  p_user_id uuid,
  p_platform_user_id uuid
)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF pg_catalog.num_nonnulls(p_user_id, p_platform_user_id) <> 1
     OR (p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM app.current_user_id())
     OR (p_platform_user_id IS NOT NULL
         AND p_platform_user_id IS DISTINCT FROM app.current_platform_user_id())
  THEN
    RAISE EXCEPTION 'session actor does not match the request context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.sessions s
     SET revoked_at = pg_catalog.now()
   WHERE s.revoked_at IS NULL
     AND ((p_user_id IS NOT NULL AND s.user_id = p_user_id)
       OR (p_platform_user_id IS NOT NULL AND s.platform_user_id = p_platform_user_id));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
