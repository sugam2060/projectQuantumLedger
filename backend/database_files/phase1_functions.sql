-- =============================================================================
-- FORTIS MULTI-TENANT RETAIL POS - PHASE 1 POSTGRESQL FUNCTIONS & TRIGGERS
-- =============================================================================
-- System: Fortis Retail Point of Sale & Retail Operations System
-- Scope: Phase 1 (Identity, Multi-Tenancy, Scoping, RBAC & Audit)
-- Engine: PostgreSQL 14+
-- Purpose: Context Management for RLS, User Access Verification, and Updated_At Triggers.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CONTEXT MANAGEMENT FUNCTIONS (Transaction-Local Scope for RLS)
-- -----------------------------------------------------------------------------

-- Sets the transaction-local context for RLS enforcement and session identity.
-- Context variables are automatically cleared on COMMIT or ROLLBACK (true parameter).
CREATE OR REPLACE FUNCTION set_tenant_context(
    p_business_id UUID,
    p_branch_id UUID DEFAULT NULL,
    p_user_id UUID DEFAULT NULL,
    p_terminal_id UUID DEFAULT NULL,
    p_is_platform_support BOOLEAN DEFAULT FALSE
) RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_business_id', p_business_id::TEXT, true);
    
    IF p_branch_id IS NOT NULL THEN
        PERFORM set_config('app.current_branch_id', p_branch_id::TEXT, true);
    ELSE
        PERFORM set_config('app.current_branch_id', '', true);
    END IF;

    IF p_user_id IS NOT NULL THEN
        PERFORM set_config('app.current_user_id', p_user_id::TEXT, true);
    ELSE
        PERFORM set_config('app.current_user_id', '', true);
    END IF;

    IF p_terminal_id IS NOT NULL THEN
        PERFORM set_config('app.current_terminal_id', p_terminal_id::TEXT, true);
    ELSE
        PERFORM set_config('app.current_terminal_id', '', true);
    END IF;

    IF p_is_platform_support THEN
        PERFORM set_config('app.is_platform_support', 'true', true);
    ELSE
        PERFORM set_config('app.is_platform_support', 'false', true);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper to retrieve current business ID in RLS policies
CREATE OR REPLACE FUNCTION get_current_business_id() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_business_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper to retrieve current branch ID in RLS policies
CREATE OR REPLACE FUNCTION get_current_branch_id() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_branch_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper to retrieve current user ID in audit logs and policies
CREATE OR REPLACE FUNCTION get_current_user_id() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_user_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper to retrieve current terminal ID
CREATE OR REPLACE FUNCTION get_current_terminal_id() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_terminal_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper to check if current request is platform support override
CREATE OR REPLACE FUNCTION is_platform_support() RETURNS BOOLEAN AS $$
BEGIN
    RETURN COALESCE(current_setting('app.is_platform_support', true) = 'true', FALSE);
END;
$$ LANGUAGE plpgsql STABLE;


-- -----------------------------------------------------------------------------
-- 2. ACCESS & AUTHORIZATION GUARDS (Phase 1 RBAC Verification)
-- -----------------------------------------------------------------------------

-- Utility to check if a user has active membership and assignment to a specific branch
CREATE OR REPLACE FUNCTION check_user_branch_access(
    p_user_id UUID,
    p_business_id UUID,
    p_branch_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_has_access BOOLEAN := FALSE;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM business_memberships bm
        JOIN branch_assignments ba ON ba.business_membership_id = bm.id
        WHERE bm.user_id = p_user_id
          AND bm.business_id = p_business_id
          AND bm.status = 'active'
          AND ba.branch_id = p_branch_id
          AND ba.status = 'active'
    ) INTO v_has_access;

    RETURN v_has_access;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Utility to check if a user holds a specific permission in a business/branch context
CREATE OR REPLACE FUNCTION check_user_permission(
    p_user_id UUID,
    p_business_id UUID,
    p_permission_code TEXT,
    p_branch_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_has_perm BOOLEAN := FALSE;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM business_memberships bm
        JOIN membership_roles mr ON mr.business_membership_id = bm.id
        JOIN roles r ON r.id = mr.role_id
        JOIN role_permissions rp ON rp.role_id = r.id
        WHERE bm.user_id = p_user_id
          AND bm.business_id = p_business_id
          AND bm.status = 'active'
          AND rp.permission_code = p_permission_code
          AND (
            r.scope_mode = 'global' 
            OR p_branch_id IS NULL 
            OR mr.branch_id IS NULL 
            OR mr.branch_id = p_branch_id
          )
    ) INTO v_has_perm;

    RETURN v_has_perm;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;


-- -----------------------------------------------------------------------------
-- 3. AUTOMATIC TIMESTAMP MAINTENANCE (updated_at Triggers)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach updated_at triggers to all Phase 1 mutable entities
DROP TRIGGER IF EXISTS trg_businesses_updated_at ON businesses;
CREATE TRIGGER trg_businesses_updated_at BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_branches_updated_at ON branches;
CREATE TRIGGER trg_branches_updated_at BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_terminals_updated_at ON terminals;
CREATE TRIGGER trg_terminals_updated_at BEFORE UPDATE ON terminals FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_business_memberships_updated_at ON business_memberships;
CREATE TRIGGER trg_business_memberships_updated_at BEFORE UPDATE ON business_memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_branch_assignments_updated_at ON branch_assignments;
CREATE TRIGGER trg_branch_assignments_updated_at BEFORE UPDATE ON branch_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_roles_updated_at ON roles;
CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_membership_roles_updated_at ON membership_roles;
CREATE TRIGGER trg_membership_roles_updated_at BEFORE UPDATE ON membership_roles FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_invitations_updated_at ON invitations;
CREATE TRIGGER trg_invitations_updated_at BEFORE UPDATE ON invitations FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
