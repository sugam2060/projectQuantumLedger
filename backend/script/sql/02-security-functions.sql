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

-- The current platform user may manage staff: active and bootstrap or admin.
CREATE OR REPLACE FUNCTION app.is_platform_admin()
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
       AND (p.is_bootstrap OR p.role = 'admin')
  );
END;
$$;

-- True when a platform account already uses this email. Only platform users may
-- ask (used to reject duplicate staff invitations).
CREATE OR REPLACE FUNCTION app.platform_email_in_use(p_email text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT app.is_platform_user() THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.platform_users p
     WHERE p.email_normalized = pg_catalog.lower(pg_catalog.btrim(p_email))
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
-- Authorization. Every business permission decision is made here: the API's
-- PermissionGuard, the RLS policies and the write functions below all use
-- app.has_permission. Business users never write memberships, roles, role
-- grants, overrides or invitations directly: only through these functions,
-- which enforce the anti-escalation rules.
-- ---------------------------------------------------------------------------

-- Kept because migration 0021 created policies that call it (a fresh database
-- replays that migration); 0025 dropped those policies, so nothing uses it now.
CREATE OR REPLACE FUNCTION app.can_manage_role(p_role_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN false;
END;
$$;

-- Does p_user_id hold the permission in the business (and, when a branch is
-- given, at that branch)? Evaluated in order:
--   1. unknown key, no active membership or inactive account  -> false
--   2. active owner                                            -> true
--   3. branch limit = membership branch, else the role's branch:
--      - a check at another branch                            -> false
--      - a business-wide check (no branch)                    -> false, except
--        the context reads business:read, branch:read, role:read
--   4. deny override                                           -> false
--   5. allow override                                          -> true
--   6. the member's role grants it                             -> true
-- Internal: fortis_app may not call it (see 03); it calls app.has_permission.
CREATE OR REPLACE FUNCTION app.member_has_permission(
  p_user_id uuid,
  p_business_id uuid,
  p_branch_id uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_member record;
  v_effect text;
BEGIN
  IF p_user_id IS NULL OR p_business_id IS NULL OR p_permission IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.key = p_permission) THEN
    RETURN false;
  END IF;

  SELECT m.is_owner,
         m.role_id,
         COALESCE(m.branch_id, r.branch_id) AS branch_id
    INTO v_member
    FROM public.business_memberships m
    JOIN public.users u ON u.id = m.user_id
    LEFT JOIN public.roles r ON r.id = m.role_id
   WHERE m.business_id = p_business_id
     AND m.user_id = p_user_id
     AND m.is_active
     AND u.status = 'active';
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_member.is_owner THEN
    RETURN true;
  END IF;

  IF v_member.branch_id IS NOT NULL THEN
    IF p_branch_id IS NULL THEN
      IF p_permission NOT IN ('business:read', 'branch:read', 'role:read') THEN
        RETURN false;
      END IF;
    ELSIF v_member.branch_id <> p_branch_id THEN
      RETURN false;
    END IF;
  END IF;

  SELECT o.effect INTO v_effect
    FROM public.member_permission_overrides o
   WHERE o.business_id = p_business_id
     AND o.user_id = p_user_id
     AND o.permission_key = p_permission;
  IF v_effect = 'deny' THEN
    RETURN false;
  ELSIF v_effect = 'allow' THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.role_permissions rp
      JOIN public.roles r ON r.id = rp.role_id
     WHERE rp.role_id = v_member.role_id
       AND rp.permission_key = p_permission
       AND (r.business_id IS NULL OR r.business_id = p_business_id)
  );
END;
$$;

-- The current user's permission check (used by the guard and RLS policies).
CREATE OR REPLACE FUNCTION app.has_permission(
  p_business_id uuid,
  p_branch_id uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN app.member_has_permission(
    app.current_user_id(), p_business_id, p_branch_id, p_permission
  );
END;
$$;

-- True only when the current user holds every one of the permissions. An empty
-- list is false (nothing to authorize means a programming error).
CREATE OR REPLACE FUNCTION app.has_all_permissions(
  p_business_id uuid,
  p_branch_id uuid,
  p_permissions text[]
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_permissions IS NULL OR pg_catalog.cardinality(p_permissions) = 0 THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM pg_catalog.unnest(p_permissions) AS k
     WHERE NOT app.has_permission(p_business_id, p_branch_id, k)
  );
END;
$$;

-- Every permission the current user holds in the business (at the branch).
CREATE OR REPLACE FUNCTION app.effective_permissions(
  p_business_id uuid,
  p_branch_id uuid
)
RETURNS SETOF text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT p.key
      FROM public.permissions p
     WHERE app.has_permission(p_business_id, p_branch_id, p.key)
     ORDER BY p.key;
END;
$$;

-- Effective permissions of another member of the business, at their own branch.
-- Only for callers with member:read there (member detail screen).
CREATE OR REPLACE FUNCTION app.member_effective_permissions(
  p_business_id uuid,
  p_user_id uuid
)
RETURNS SETOF text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_branch uuid;
BEGIN
  SELECT COALESCE(m.branch_id, r.branch_id) INTO v_branch
    FROM public.business_memberships m
    LEFT JOIN public.roles r ON r.id = m.role_id
   WHERE m.business_id = p_business_id AND m.user_id = p_user_id AND m.is_active;
  IF NOT FOUND OR NOT app.has_permission(p_business_id, v_branch, 'member:read') THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT p.key
      FROM public.permissions p
     WHERE app.member_has_permission(p_user_id, p_business_id, v_branch, p.key)
     ORDER BY p.key;
END;
$$;

-- Does the current user hold every permission in the list? (An empty list is
-- true: holding nothing extra is always allowed.)
CREATE OR REPLACE FUNCTION app.holds_all(
  p_business_id uuid,
  p_branch_id uuid,
  p_permissions text[]
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM pg_catalog.unnest(COALESCE(p_permissions, '{}'::text[])) AS k
     WHERE NOT app.has_permission(p_business_id, p_branch_id, k)
  );
END;
$$;

-- Permission keys a role grants.
CREATE OR REPLACE FUNCTION app.role_permission_keys(p_role_id uuid)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(pg_catalog.array_agg(rp.permission_key ORDER BY rp.permission_key), '{}')
      FROM public.role_permissions rp
     WHERE rp.role_id = p_role_id
  );
END;
$$;

-- May the current user act on this member? Outcomes: ok | not_found | forbidden.
--   - the member must be active in the business (and in p_scope_branch when the
--     caller works through a branch route; others look not found);
--   - never yourself and never the owner;
--   - never someone who holds a permission you do not hold (at their branch).
CREATE OR REPLACE FUNCTION app.check_manageable_member(
  p_business_id uuid,
  p_scope_branch_id uuid,
  p_user_id uuid
)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_target record;
BEGIN
  SELECT m.is_owner, COALESCE(m.branch_id, r.branch_id) AS branch_id
    INTO v_target
    FROM public.business_memberships m
    LEFT JOIN public.roles r ON r.id = m.role_id
   WHERE m.business_id = p_business_id AND m.user_id = p_user_id AND m.is_active;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF p_scope_branch_id IS NOT NULL
     AND v_target.branch_id IS DISTINCT FROM p_scope_branch_id THEN
    RETURN 'not_found';
  END IF;
  IF p_user_id = app.current_user_id() OR v_target.is_owner THEN
    RETURN 'forbidden';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.permissions p
     WHERE app.member_has_permission(p_user_id, p_business_id, v_target.branch_id, p.key)
       AND NOT app.has_permission(p_business_id, v_target.branch_id, p.key)
  ) THEN
    RETURN 'forbidden';
  END IF;
  RETURN 'ok';
END;
$$;

-- Checks a (role, branch) assignment the current user wants to give someone in
-- the business. Outcomes: ok | invalid | forbidden.
CREATE OR REPLACE FUNCTION app.check_assignable_role(
  p_business_id uuid,
  p_scope_branch_id uuid,
  p_role_id uuid,
  p_branch_id uuid
)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_role record;
BEGIN
  SELECT r.business_id, r.branch_id INTO v_role
    FROM public.roles r WHERE r.id = p_role_id;
  IF NOT FOUND OR (v_role.business_id IS NOT NULL AND v_role.business_id <> p_business_id) THEN
    RETURN 'invalid';
  END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.id = p_branch_id AND b.business_id = p_business_id
  ) THEN
    RETURN 'invalid';
  END IF;
  -- A branch-level role is usable only by members of that branch.
  IF v_role.branch_id IS NOT NULL AND p_branch_id IS DISTINCT FROM v_role.branch_id THEN
    RETURN 'invalid';
  END IF;
  -- Through a branch route, people can only be placed in that branch.
  IF p_scope_branch_id IS NOT NULL AND p_branch_id IS DISTINCT FROM p_scope_branch_id THEN
    RETURN 'forbidden';
  END IF;
  -- Nobody can hand out a permission they do not hold themselves.
  IF NOT app.holds_all(p_business_id, p_branch_id, app.role_permission_keys(p_role_id)) THEN
    RETURN 'forbidden';
  END IF;
  RETURN 'ok';
END;
$$;

-- Ends every session of a business user (used when access changes under them).
CREATE OR REPLACE FUNCTION app.revoke_user_sessions(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE public.sessions s SET revoked_at = pg_catalog.now()
   WHERE s.user_id = p_user_id AND s.revoked_at IS NULL;
END;
$$;

-- Changes a member's role and/or branch. Outcomes: ok | not_found | forbidden |
-- invalid. Moving someone to another branch signs them out everywhere.
CREATE OR REPLACE FUNCTION app.update_member(
  p_business_id uuid,
  p_scope_branch_id uuid,
  p_user_id uuid,
  p_change_role boolean,
  p_role_id uuid,
  p_change_branch boolean,
  p_branch_id uuid
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_outcome text;
  v_member record;
  v_role_id uuid;
  v_branch_id uuid;
BEGIN
  IF NOT app.has_permission(p_business_id, p_scope_branch_id, 'member:update') THEN
    RETURN 'forbidden';
  END IF;
  v_outcome := app.check_manageable_member(p_business_id, p_scope_branch_id, p_user_id);
  IF v_outcome <> 'ok' THEN
    RETURN v_outcome;
  END IF;

  SELECT m.id, m.role_id, m.branch_id INTO v_member
    FROM public.business_memberships m
   WHERE m.business_id = p_business_id AND m.user_id = p_user_id AND m.is_active
     FOR UPDATE;

  v_role_id := CASE WHEN p_change_role THEN p_role_id ELSE v_member.role_id END;
  v_branch_id := CASE WHEN p_change_branch THEN p_branch_id ELSE v_member.branch_id END;
  IF v_role_id IS NULL THEN
    RETURN 'invalid';
  END IF;
  v_outcome := app.check_assignable_role(p_business_id, p_scope_branch_id, v_role_id, v_branch_id);
  IF v_outcome <> 'ok' THEN
    RETURN v_outcome;
  END IF;

  UPDATE public.business_memberships
     SET role_id = v_role_id, branch_id = v_branch_id, updated_at = pg_catalog.now()
   WHERE id = v_member.id;
  IF v_branch_id IS DISTINCT FROM v_member.branch_id THEN
    PERFORM app.revoke_user_sessions(p_user_id);
  END IF;
  RETURN 'ok';
END;
$$;

-- Ends a membership: inactive, overrides removed, every session revoked.
-- Outcomes: ok | not_found | forbidden.
CREATE OR REPLACE FUNCTION app.end_membership(
  p_business_id uuid,
  p_scope_branch_id uuid,
  p_user_id uuid
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_outcome text;
BEGIN
  IF NOT app.has_permission(p_business_id, p_scope_branch_id, 'member:end') THEN
    RETURN 'forbidden';
  END IF;
  v_outcome := app.check_manageable_member(p_business_id, p_scope_branch_id, p_user_id);
  IF v_outcome <> 'ok' THEN
    RETURN v_outcome;
  END IF;
  UPDATE public.business_memberships
     SET is_active = false, updated_at = pg_catalog.now()
   WHERE business_id = p_business_id AND user_id = p_user_id AND is_active;
  DELETE FROM public.member_permission_overrides
   WHERE business_id = p_business_id AND user_id = p_user_id;
  PERFORM app.revoke_user_sessions(p_user_id);
  RETURN 'ok';
END;
$$;

-- Sets an allow/deny override. Granting (allow) needs the permission yourself.
-- Outcomes: ok | not_found | forbidden | invalid.
CREATE OR REPLACE FUNCTION app.set_member_override(
  p_business_id uuid,
  p_user_id uuid,
  p_permission text,
  p_effect text
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_outcome text;
  v_branch uuid;
BEGIN
  IF NOT app.has_permission(p_business_id, NULL, 'override:manage') THEN
    RETURN 'forbidden';
  END IF;
  IF p_effect NOT IN ('allow', 'deny')
     OR NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.key = p_permission) THEN
    RETURN 'invalid';
  END IF;
  v_outcome := app.check_manageable_member(p_business_id, NULL, p_user_id);
  IF v_outcome <> 'ok' THEN
    RETURN v_outcome;
  END IF;
  SELECT COALESCE(m.branch_id, r.branch_id) INTO v_branch
    FROM public.business_memberships m
    LEFT JOIN public.roles r ON r.id = m.role_id
   WHERE m.business_id = p_business_id AND m.user_id = p_user_id AND m.is_active;
  IF p_effect = 'allow' AND NOT app.has_permission(p_business_id, v_branch, p_permission) THEN
    RETURN 'forbidden';
  END IF;

  INSERT INTO public.member_permission_overrides
    (business_id, user_id, permission_key, effect, created_by)
  VALUES (p_business_id, p_user_id, p_permission, p_effect, app.current_user_id())
  ON CONFLICT (business_id, user_id, permission_key)
  DO UPDATE SET effect = EXCLUDED.effect,
                created_by = EXCLUDED.created_by,
                updated_at = pg_catalog.now();
  RETURN 'ok';
END;
$$;

-- Removes an override. Lifting a deny is granting: it needs the permission.
-- Outcomes: ok | not_found | forbidden | invalid.
CREATE OR REPLACE FUNCTION app.clear_member_override(
  p_business_id uuid,
  p_user_id uuid,
  p_permission text
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_outcome text;
  v_effect text;
  v_branch uuid;
BEGIN
  IF NOT app.has_permission(p_business_id, NULL, 'override:manage') THEN
    RETURN 'forbidden';
  END IF;
  v_outcome := app.check_manageable_member(p_business_id, NULL, p_user_id);
  IF v_outcome <> 'ok' THEN
    RETURN v_outcome;
  END IF;
  SELECT o.effect INTO v_effect
    FROM public.member_permission_overrides o
   WHERE o.business_id = p_business_id AND o.user_id = p_user_id
     AND o.permission_key = p_permission
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_effect = 'deny' THEN
    SELECT COALESCE(m.branch_id, r.branch_id) INTO v_branch
      FROM public.business_memberships m
      LEFT JOIN public.roles r ON r.id = m.role_id
     WHERE m.business_id = p_business_id AND m.user_id = p_user_id AND m.is_active;
    IF NOT app.has_permission(p_business_id, v_branch, p_permission) THEN
      RETURN 'forbidden';
    END IF;
  END IF;
  DELETE FROM public.member_permission_overrides
   WHERE business_id = p_business_id AND user_id = p_user_id
     AND permission_key = p_permission;
  RETURN 'ok';
END;
$$;

-- Creates (p_role_id NULL) or updates a custom role. The branch of a role is
-- fixed at creation. Every permission put into a role must be held by the
-- caller, and a role can only be edited by someone holding all it grants.
-- Outcomes: ok | not_found | forbidden | invalid | conflict.
CREATE OR REPLACE FUNCTION app.save_role(
  p_business_id uuid,
  p_role_id uuid,
  p_key text,
  p_name text,
  p_description text,
  p_branch_id uuid,
  p_set_permissions boolean,
  p_permissions text[]
)
RETURNS TABLE (outcome text, role_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role record;
  v_id uuid;
  v_keys text[] := COALESCE(p_permissions, '{}'::text[]);
BEGIN
  IF p_role_id IS NULL THEN
    IF NOT app.has_permission(p_business_id, NULL, 'role:create') THEN
      RETURN QUERY SELECT 'forbidden'::text, NULL::uuid; RETURN;
    END IF;
    IF p_branch_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.branches b
       WHERE b.id = p_branch_id AND b.business_id = p_business_id
    ) THEN
      RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
    END IF;
  ELSE
    IF NOT app.has_permission(p_business_id, NULL, 'role:update') THEN
      RETURN QUERY SELECT 'forbidden'::text, NULL::uuid; RETURN;
    END IF;
    SELECT r.id, r.is_system, r.business_id INTO v_role
      FROM public.roles r WHERE r.id = p_role_id FOR UPDATE;
    IF NOT FOUND OR v_role.business_id IS DISTINCT FROM p_business_id THEN
      RETURN QUERY SELECT
        CASE WHEN FOUND AND v_role.is_system THEN 'forbidden' ELSE 'not_found' END::text,
        NULL::uuid;
      RETURN;
    END IF;
    IF NOT app.holds_all(p_business_id, NULL, app.role_permission_keys(p_role_id)) THEN
      RETURN QUERY SELECT 'forbidden'::text, NULL::uuid; RETURN;
    END IF;
  END IF;

  IF p_set_permissions THEN
    IF EXISTS (
      SELECT 1 FROM pg_catalog.unnest(v_keys) k
       WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.key = k)
    ) THEN
      RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
    END IF;
    IF NOT app.holds_all(p_business_id, NULL, v_keys) THEN
      RETURN QUERY SELECT 'forbidden'::text, NULL::uuid; RETURN;
    END IF;
  END IF;

  BEGIN
    IF p_role_id IS NULL THEN
      INSERT INTO public.roles (business_id, branch_id, key, name, description, is_system)
      VALUES (p_business_id, p_branch_id, p_key, p_name, p_description, false)
      RETURNING id INTO v_id;
    ELSE
      v_id := p_role_id;
      UPDATE public.roles
         SET key = COALESCE(p_key, key),
             name = COALESCE(p_name, name),
             description = CASE WHEN p_description IS NULL THEN description
                                WHEN p_description = '' THEN NULL
                                ELSE p_description END,
             updated_at = pg_catalog.now()
       WHERE id = v_id;  -- roles_bump_template_version raises roles.version
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT 'conflict'::text, NULL::uuid; RETURN;
  END;

  IF p_set_permissions THEN
    DELETE FROM public.role_permissions rp
     WHERE rp.role_id = v_id AND rp.permission_key <> ALL (v_keys);
    INSERT INTO public.role_permissions (role_id, permission_key)
    SELECT v_id, k FROM pg_catalog.unnest(v_keys) k
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN QUERY SELECT 'ok'::text, v_id;
END;
$$;

-- Deletes a custom role nobody uses. Outcomes: ok | not_found | forbidden |
-- conflict (active members or open invitations still use it).
CREATE OR REPLACE FUNCTION app.delete_role(p_business_id uuid, p_role_id uuid)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_role record;
BEGIN
  IF NOT app.has_permission(p_business_id, NULL, 'role:delete') THEN
    RETURN 'forbidden';
  END IF;
  SELECT r.is_system, r.business_id INTO v_role
    FROM public.roles r WHERE r.id = p_role_id FOR UPDATE;
  IF NOT FOUND OR v_role.business_id IS DISTINCT FROM p_business_id THEN
    RETURN CASE WHEN FOUND AND v_role.is_system THEN 'forbidden' ELSE 'not_found' END;
  END IF;
  IF NOT app.holds_all(p_business_id, NULL, app.role_permission_keys(p_role_id)) THEN
    RETURN 'forbidden';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.business_memberships m
     WHERE m.role_id = p_role_id AND m.is_active
  ) OR EXISTS (
    SELECT 1 FROM public.invitations i
     WHERE i.role_id = p_role_id AND i.consumed_at IS NULL AND i.revoked_at IS NULL
       AND i.expires_at > pg_catalog.now()
  ) THEN
    RETURN 'conflict';
  END IF;
  -- Finished invitations keep no history worth a dangling role.
  DELETE FROM public.invitations i WHERE i.role_id = p_role_id;
  DELETE FROM public.roles WHERE id = p_role_id;
  RETURN 'ok';
END;
$$;

-- ---------------------------------------------------------------------------
-- Business invitations. Created, reissued and revoked only through these
-- functions; accepted (publicly, with the emailed token) only through
-- app.accept_business_invitation.
-- ---------------------------------------------------------------------------

-- Outcomes: invited | already_member | already_invited | invalid | forbidden.
CREATE OR REPLACE FUNCTION app.create_business_invitation(
  p_business_id uuid,
  p_scope_branch_id uuid,
  p_email text,
  p_role_id uuid,
  p_branch_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_outcome text;
BEGIN
  IF NOT app.has_permission(p_business_id, p_scope_branch_id, 'member:invite') THEN
    RETURN 'forbidden';
  END IF;
  v_outcome := app.check_assignable_role(p_business_id, p_scope_branch_id, p_role_id, p_branch_id);
  IF v_outcome <> 'ok' THEN
    RETURN v_outcome;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.business_memberships m
      JOIN public.users u ON u.id = m.user_id
     WHERE m.business_id = p_business_id AND m.is_active AND u.email_normalized = v_email
  ) THEN
    RETURN 'already_member';
  END IF;
  -- An expired open invitation does not block a new one.
  UPDATE public.invitations i SET revoked_at = pg_catalog.now()
   WHERE i.business_id = p_business_id AND i.email_normalized = v_email
     AND i.invitation_type = 'business_user'
     AND i.consumed_at IS NULL AND i.revoked_at IS NULL
     AND i.expires_at <= pg_catalog.now();
  BEGIN
    INSERT INTO public.invitations
      (business_id, email_normalized, role_id, branch_id, invitation_type,
       token_hash, expires_at, invited_by_user_id)
    VALUES
      (p_business_id, v_email, p_role_id, p_branch_id, 'business_user',
       p_token_hash, p_expires_at, app.current_user_id());
  EXCEPTION WHEN unique_violation THEN
    RETURN 'already_invited';
  END;
  RETURN 'invited';
END;
$$;

-- New token and expiry for an open invitation. Outcomes: ok | not_found |
-- forbidden. Returns the invitee email for the new message.
CREATE OR REPLACE FUNCTION app.reissue_business_invitation(
  p_business_id uuid,
  p_scope_branch_id uuid,
  p_invitation_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS TABLE (outcome text, email text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_inv record;
  v_outcome text;
BEGIN
  IF NOT app.has_permission(p_business_id, p_scope_branch_id, 'member:invite') THEN
    RETURN QUERY SELECT 'forbidden'::text, NULL::text; RETURN;
  END IF;
  SELECT i.id, i.email_normalized, i.role_id, i.branch_id INTO v_inv
    FROM public.invitations i
   WHERE i.id = p_invitation_id AND i.business_id = p_business_id
     AND i.invitation_type = 'business_user'
     AND i.consumed_at IS NULL AND i.revoked_at IS NULL
     AND (p_scope_branch_id IS NULL OR i.branch_id = p_scope_branch_id)
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text; RETURN;
  END IF;
  v_outcome := app.check_assignable_role(p_business_id, p_scope_branch_id, v_inv.role_id, v_inv.branch_id);
  IF v_outcome <> 'ok' THEN
    RETURN QUERY SELECT v_outcome, NULL::text; RETURN;
  END IF;
  UPDATE public.invitations
     SET token_hash = p_token_hash, expires_at = p_expires_at, updated_at = pg_catalog.now()
   WHERE id = v_inv.id;
  RETURN QUERY SELECT 'ok'::text, v_inv.email_normalized;
END;
$$;

-- Outcomes: ok | not_found | forbidden.
CREATE OR REPLACE FUNCTION app.revoke_business_invitation(
  p_business_id uuid,
  p_scope_branch_id uuid,
  p_invitation_id uuid
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT app.has_permission(p_business_id, p_scope_branch_id, 'member:invite') THEN
    RETURN 'forbidden';
  END IF;
  UPDATE public.invitations i
     SET revoked_at = pg_catalog.now(), updated_at = pg_catalog.now()
   WHERE i.id = p_invitation_id AND i.business_id = p_business_id
     AND i.invitation_type = 'business_user'
     AND i.consumed_at IS NULL AND i.revoked_at IS NULL
     AND (p_scope_branch_id IS NULL OR i.branch_id = p_scope_branch_id);
  RETURN CASE WHEN FOUND THEN 'ok' ELSE 'not_found' END;
END;
$$;

-- Public: what an open, unexpired invitation is for (by its token hash).
CREATE OR REPLACE FUNCTION app.preview_business_invitation(p_token_hash text)
RETURNS TABLE (
  email text,
  business_name text,
  role_name text,
  branch_name text,
  expires_at timestamptz,
  account_exists boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT i.email_normalized, b.display_name, r.name, br.name, i.expires_at,
           EXISTS (SELECT 1 FROM public.users u WHERE u.email_normalized = i.email_normalized)
      FROM public.invitations i
      JOIN public.business b ON b.id = i.business_id AND b.is_active
      JOIN public.roles r ON r.id = i.role_id
      LEFT JOIN public.branches br ON br.id = i.branch_id
     WHERE i.token_hash = p_token_hash
       AND i.invitation_type = 'business_user'
       AND i.consumed_at IS NULL AND i.revoked_at IS NULL
       AND i.expires_at > pg_catalog.now();
END;
$$;

-- Public: accepts an invitation, single use. Existing accounts pass their id
-- (the API verified the password); new accounts pass a name and a password
-- hash. Outcomes:
--   accepted          membership created (or reactivated)
--   invalid           token unusable, account mismatch or disabled, role gone
--   account_exists    new-account path but the email already has an account
--   active_membership the account is active elsewhere; confirm to resign
--   owner_elsewhere   the account owns another business (cannot resign)
CREATE OR REPLACE FUNCTION app.accept_business_invitation(
  p_token_hash text,
  p_user_id uuid,
  p_name text,
  p_password_hash text,
  p_confirm_resignation boolean
)
RETURNS TABLE (outcome text, user_id uuid, business_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_inv record;
  v_user record;
  v_user_id uuid;
  v_other record;
BEGIN
  SELECT i.id, i.business_id, i.email_normalized, i.role_id, i.branch_id INTO v_inv
    FROM public.invitations i
    JOIN public.business b ON b.id = i.business_id AND b.is_active
   WHERE i.token_hash = p_token_hash
     AND i.invitation_type = 'business_user'
     AND i.consumed_at IS NULL AND i.revoked_at IS NULL
     AND i.expires_at > pg_catalog.now()
     FOR UPDATE OF i;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.roles r
     WHERE r.id = v_inv.role_id
       AND (r.business_id IS NULL OR r.business_id = v_inv.business_id)
       AND (r.branch_id IS NULL OR r.branch_id IS NOT DISTINCT FROM v_inv.branch_id)
  ) THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid; RETURN;
  END IF;

  SELECT u.id, u.status INTO v_user
    FROM public.users u WHERE u.email_normalized = v_inv.email_normalized
     FOR UPDATE;
  IF p_user_id IS NOT NULL THEN
    IF NOT FOUND OR v_user.id <> p_user_id OR v_user.status <> 'active' THEN
      RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid; RETURN;
    END IF;
    v_user_id := v_user.id;
  ELSE
    IF FOUND THEN
      RETURN QUERY SELECT 'account_exists'::text, NULL::uuid, NULL::uuid; RETURN;
    END IF;
    IF p_name IS NULL OR pg_catalog.btrim(p_name) = '' OR p_password_hash IS NULL THEN
      RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid; RETURN;
    END IF;
    INSERT INTO public.users (email_normalized, password_hash, name, status)
    VALUES (v_inv.email_normalized, p_password_hash, pg_catalog.btrim(p_name), 'active')
    RETURNING id INTO v_user_id;
  END IF;

  SELECT m.id, m.business_id, m.is_owner INTO v_other
    FROM public.business_memberships m
   WHERE m.user_id = v_user_id AND m.is_active
     FOR UPDATE;
  IF FOUND THEN
    IF v_other.business_id = v_inv.business_id THEN
      RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid; RETURN;
    END IF;
    IF v_other.is_owner THEN
      RETURN QUERY SELECT 'owner_elsewhere'::text, NULL::uuid, NULL::uuid; RETURN;
    END IF;
    IF NOT COALESCE(p_confirm_resignation, false) THEN
      RETURN QUERY SELECT 'active_membership'::text, NULL::uuid, NULL::uuid; RETURN;
    END IF;
    UPDATE public.business_memberships
       SET is_active = false, updated_at = pg_catalog.now()
     WHERE id = v_other.id;
    DELETE FROM public.member_permission_overrides o
     WHERE o.business_id = v_other.business_id AND o.user_id = v_user_id;
    PERFORM app.revoke_user_sessions(v_user_id);
  END IF;

  INSERT INTO public.business_memberships (business_id, user_id, role_id, branch_id, is_owner, is_active)
  VALUES (v_inv.business_id, v_user_id, v_inv.role_id, v_inv.branch_id, false, true)
  ON CONFLICT (user_id, business_id) DO UPDATE
     SET role_id = EXCLUDED.role_id,
         branch_id = EXCLUDED.branch_id,
         is_owner = false,
         is_active = true,
         updated_at = pg_catalog.now();
  DELETE FROM public.member_permission_overrides o
   WHERE o.business_id = v_inv.business_id AND o.user_id = v_user_id;

  UPDATE public.invitations SET consumed_at = pg_catalog.now(), updated_at = pg_catalog.now()
   WHERE id = v_inv.id;
  RETURN QUERY SELECT 'accepted'::text, v_user_id, v_inv.business_id;
END;
$$;

-- Public: accepts a Fortis staff invitation, single use; creates the platform
-- account with the invited name and platform role. Outcomes: accepted | invalid.
CREATE OR REPLACE FUNCTION app.accept_platform_invitation(
  p_token_hash text,
  p_password_hash text
)
RETURNS TABLE (outcome text, platform_user_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_inv record;
  v_id uuid;
BEGIN
  -- The inviter must still be an active platform admin (bootstrap or role
  -- admin): only admins may create staff accounts, of any role.
  SELECT i.id, i.email_normalized, i.invitee_name, i.platform_role INTO v_inv
    FROM public.invitations i
    JOIN public.platform_users inviter
      ON inviter.id = i.invited_by_platform_user_id
     AND inviter.status = 'active'
     AND (inviter.is_bootstrap OR inviter.role = 'admin')
   WHERE i.token_hash = p_token_hash
     AND i.invitation_type = 'platform_user'
     AND i.consumed_at IS NULL AND i.revoked_at IS NULL
     AND i.expires_at > pg_catalog.now()
     FOR UPDATE OF i;
  IF NOT FOUND OR p_password_hash IS NULL OR EXISTS (
    SELECT 1 FROM public.platform_users p WHERE p.email_normalized = v_inv.email_normalized
  ) THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
  END IF;
  INSERT INTO public.platform_users (email_normalized, password_hash, name, status, role)
  VALUES (v_inv.email_normalized, p_password_hash, v_inv.invitee_name, 'active',
          COALESCE(v_inv.platform_role, 'support'))
  RETURNING id INTO v_id;
  UPDATE public.invitations SET consumed_at = pg_catalog.now(), updated_at = pg_catalog.now()
   WHERE id = v_inv.id;
  RETURN QUERY SELECT 'accepted'::text, v_id;
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
DROP FUNCTION IF EXISTS app.auth_find_platform_user_by_email(text);
CREATE OR REPLACE FUNCTION app.auth_find_platform_user_by_email(p_email text)
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  password_hash text,
  status text,
  is_bootstrap boolean,
  role text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT p.id, p.email_normalized, p.name, p.password_hash, p.status,
           p.is_bootstrap, p.role
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
  is_bootstrap boolean,
  role text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT p.id, p.email_normalized, p.name, p.status, p.is_bootstrap, p.role
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

-- ---------------------------------------------------------------------------
-- Password reset. public.password_reset_tokens has RLS with no policies; only
-- these functions touch it. p_actor is 'user' or 'platform'.
-- ---------------------------------------------------------------------------

-- Issues a reset token for an active account with this email. Earlier open tokens
-- of that account are invalidated (at most one new link per minute). Returns the account (for the email) or no row,
-- so the caller can answer the same way whether or not the account exists.
CREATE OR REPLACE FUNCTION app.auth_create_reset_token(
  p_actor text,
  p_email text,
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS TABLE (account_id uuid, email text, name text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_email text;
  v_name text;
BEGIN
  IF p_actor = 'user' THEN
    SELECT u.id, u.email_normalized, u.name INTO v_id, v_email, v_name
      FROM public.users u
     WHERE u.email_normalized = pg_catalog.lower(pg_catalog.btrim(p_email))
       AND u.status = 'active';
  ELSIF p_actor = 'platform' THEN
    SELECT p.id, p.email_normalized, p.name INTO v_id, v_email, v_name
      FROM public.platform_users p
     WHERE p.email_normalized = pg_catalog.lower(pg_catalog.btrim(p_email))
       AND p.status = 'active';
  ELSE
    RAISE EXCEPTION 'unknown actor %', p_actor;
  END IF;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  -- Cooldown: a link issued in the last minute is not replaced, so repeated
  -- anonymous requests cannot keep invalidating someone's pending link.
  IF EXISTS (
    SELECT 1 FROM public.password_reset_tokens t
     WHERE t.consumed_at IS NULL
       AND t.created_at > pg_catalog.now() - interval '60 seconds'
       AND ((p_actor = 'user' AND t.user_id = v_id)
         OR (p_actor = 'platform' AND t.platform_user_id = v_id))
  ) THEN
    RETURN;
  END IF;

  UPDATE public.password_reset_tokens t
     SET consumed_at = pg_catalog.now()
   WHERE t.consumed_at IS NULL
     AND ((p_actor = 'user' AND t.user_id = v_id)
       OR (p_actor = 'platform' AND t.platform_user_id = v_id));

  INSERT INTO public.password_reset_tokens (
    user_id, platform_user_id, token_hash, expires_at
  ) VALUES (
    CASE WHEN p_actor = 'user' THEN v_id END,
    CASE WHEN p_actor = 'platform' THEN v_id END,
    p_token_hash,
    p_expires_at
  );

  RETURN QUERY SELECT v_id, v_email, v_name;
END;
$$;

-- Consumes a reset token (single use, enforced by one UPDATE ... WHERE
-- consumed_at IS NULL), stores the new password hash and revokes every session of
-- the account. Returns the account id, or no row when the token is unknown,
-- expired, already used or the account is no longer active.
CREATE OR REPLACE FUNCTION app.auth_consume_reset_token(
  p_actor text,
  p_token_hash text,
  p_password_hash text
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_platform uuid;
BEGIN
  UPDATE public.password_reset_tokens t
     SET consumed_at = pg_catalog.now()
   WHERE t.token_hash = p_token_hash
     AND t.consumed_at IS NULL
     AND t.expires_at > pg_catalog.now()
     AND ((p_actor = 'user' AND t.user_id IS NOT NULL)
       OR (p_actor = 'platform' AND t.platform_user_id IS NOT NULL))
  RETURNING t.user_id, t.platform_user_id INTO v_user, v_platform;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_user IS NOT NULL THEN
    UPDATE public.users u
       SET password_hash = p_password_hash, updated_at = pg_catalog.now()
     WHERE u.id = v_user AND u.status = 'active';
    IF NOT FOUND THEN RETURN NULL; END IF;
    UPDATE public.sessions s SET revoked_at = pg_catalog.now()
     WHERE s.user_id = v_user AND s.revoked_at IS NULL;
    RETURN v_user;
  END IF;

  UPDATE public.platform_users p
     SET password_hash = p_password_hash, updated_at = pg_catalog.now()
   WHERE p.id = v_platform AND p.status = 'active';
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.sessions s SET revoked_at = pg_catalog.now()
   WHERE s.platform_user_id = v_platform AND s.revoked_at IS NULL;
  RETURN v_platform;
END;
$$;

-- The current user's (or platform user's) own password hash, for change-password.
CREATE OR REPLACE FUNCTION app.auth_current_password_hash()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_hash text;
BEGIN
  IF app.current_user_id() IS NOT NULL THEN
    SELECT u.password_hash INTO v_hash FROM public.users u
     WHERE u.id = app.current_user_id() AND u.status = 'active';
  ELSIF app.current_platform_user_id() IS NOT NULL THEN
    SELECT p.password_hash INTO v_hash FROM public.platform_users p
     WHERE p.id = app.current_platform_user_id() AND p.status = 'active';
  END IF;
  RETURN v_hash;
END;
$$;
