-- 1. Get the current active Business ID for the session
CREATE OR REPLACE FUNCTION public.app_business_id()
RETURNS UUID AS $$
BEGIN
    -- Returns NULL if not set, or safely casts the session variable to UUID
    RETURN NULLIF(current_setting('app.business_id', true), '')::UUID;
EXCEPTION
    WHEN others THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;


-- 2. Get the current active Branch ID for the session (optional/nullable)
CREATE OR REPLACE FUNCTION public.app_branch_id()
RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.branch_id', true), '')::UUID;
EXCEPTION
    WHEN others THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;


-- 3. Get the ID of the currently authenticated user
CREATE OR REPLACE FUNCTION public.app_user_id()
RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.user_id', true), '')::UUID;
EXCEPTION
    WHEN others THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;


-- 4. Check if the current session belongs to a platform super-admin
CREATE OR REPLACE FUNCTION public.app_is_platform()
RETURNS BOOLEAN AS $$
BEGIN
    -- Evaluates to true only if explicitly set to 'true' or '1'
    RETURN COALESCE(current_setting('app.is_platform_user', true), 'false') IN ('true', '1', 't', 'yes');
EXCEPTION
    WHEN others THEN
        RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE;


--  Check if the current user is an owner of the current business
CREATE OR REPLACE FUNCTION public.app_is_owner() 
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM business_memberships bm
        WHERE bm.business_id = app_business_id()
          AND bm.user_id = app_user_id()
          AND bm.is_active = true
          AND bm.is_owner = true
    );
EXCEPTION
    WHEN others THEN
        RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE;

-- Get the ID of the currently authenticated platform user
CREATE OR REPLACE FUNCTION public.app_platform_user_id() 
RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.platform_user_id', true), '')::UUID;
EXCEPTION
    WHEN others THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Check if the current platform user is a bootstrap administrator
CREATE OR REPLACE FUNCTION public.app_is_bootstrap_platform() 
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM platform_users pu
        WHERE pu.id = app_platform_user_id()
          AND pu.is_bootstrap = true
          AND pu.status = 'active'
    );
EXCEPTION
    WHEN others THEN
        RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE;