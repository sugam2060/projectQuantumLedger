-- Reference data for authorization: the permission catalogue, the system roles
-- and their grants. Applied by script/migrate.ts after the Drizzle migrations,
-- on every run, inside one transaction (all or nothing).
--
-- Idempotent and declarative: this file is the source of truth.
--   * permissions      inserted, descriptions updated. Keys never deleted here
--                      (custom-role grants and overrides reference them).
--   * system roles     inserted, name/description updated. Never deleted here
--                      (memberships reference them).
--   * system grants    synced exactly: missing grants added, extra ones removed;
--                      a role whose grants changed gets version + 1.
--
-- The catalogue must equal src/authorization/permission.constant.ts
-- (test/authorization/permissions.db-spec.ts checks this).
-- Adding a permission: add it to `Permission`, add a row below and the grants
-- for the system roles that should have it, then `npm run db:migrate`.

-- 1. Permission catalogue -----------------------------------------------------
INSERT INTO "permissions" ("key", "description") VALUES
  ('business:read', 'View the business profile'),
  ('business:update', 'Edit the business profile and documents'),
  ('branch:read', 'View branches'),
  ('branch:update', 'Edit branch details'),
  ('terminal:read', 'View terminals'),
  ('terminal:activate', 'Activate a terminal with its code'),
  ('terminal:update', 'Edit terminal details'),
  ('terminal:revoke', 'Deactivate a terminal'),
  ('member:read', 'View members and invitations'),
  ('member:invite', 'Invite members and manage invitations'),
  ('member:update', 'Change a member''s role or branch'),
  ('member:end', 'End a membership'),
  ('role:read', 'View roles and their permissions'),
  ('role:create', 'Create custom roles'),
  ('role:update', 'Edit custom roles'),
  ('role:delete', 'Delete custom roles'),
  ('override:manage', 'Grant or deny single permissions to a member'),
  ('audit:read', 'View audit and access logs')
ON CONFLICT ("key") DO UPDATE
  SET "description" = EXCLUDED."description"
  WHERE "permissions"."description" IS DISTINCT FROM EXCLUDED."description";

-- 2. System roles (shared by every business, read-only for fortis_app) --------
CREATE TEMPORARY TABLE seed_system_roles (key text PRIMARY KEY, name text NOT NULL, description text NOT NULL)
  ON COMMIT DROP;
INSERT INTO seed_system_roles (key, name, description) VALUES
  ('admin', 'Admin', 'Everything the owner can do except ownership'),
  ('branch-manager', 'Branch manager', 'Runs a branch: terminals, staff and invitations'),
  ('cashier', 'Cashier', 'Sells at a terminal'),
  ('inventory-manager', 'Inventory manager', 'Manages stock'),
  ('accountant', 'Accountant', 'Reads finances and audit logs'),
  ('viewer', 'Viewer', 'Read-only access');

UPDATE "roles" r
   SET "name" = s.name, "description" = s.description, "updated_at" = now()
  FROM seed_system_roles s
 WHERE r."business_id" IS NULL AND r."is_system" AND r."key" = s.key
   AND (r."name", r."description") IS DISTINCT FROM (s.name, s.description);

INSERT INTO "roles" ("business_id", "key", "name", "description", "is_system")
SELECT NULL, s.key, s.name, s.description, true
  FROM seed_system_roles s
 WHERE NOT EXISTS (
   SELECT 1 FROM "roles" r WHERE r."business_id" IS NULL AND r."key" = s.key
 );

-- 3. System role grants -------------------------------------------------------
CREATE TEMPORARY TABLE seed_system_grants (role_key text NOT NULL, permission_key text NOT NULL,
                                           PRIMARY KEY (role_key, permission_key))
  ON COMMIT DROP;

-- admin: every permission in the catalogue above.
INSERT INTO seed_system_grants (role_key, permission_key)
SELECT 'admin', p."key" FROM "permissions" p;

INSERT INTO seed_system_grants (role_key, permission_key) VALUES
  ('branch-manager', 'business:read'), ('branch-manager', 'branch:read'),
  ('branch-manager', 'branch:update'), ('branch-manager', 'terminal:read'),
  ('branch-manager', 'terminal:activate'), ('branch-manager', 'terminal:update'),
  ('branch-manager', 'terminal:revoke'), ('branch-manager', 'member:read'),
  ('branch-manager', 'member:invite'), ('branch-manager', 'member:update'),
  ('branch-manager', 'role:read'), ('branch-manager', 'audit:read'),
  ('cashier', 'business:read'), ('cashier', 'branch:read'),
  ('cashier', 'terminal:read'),
  ('inventory-manager', 'business:read'), ('inventory-manager', 'branch:read'),
  ('inventory-manager', 'terminal:read'),
  ('accountant', 'business:read'), ('accountant', 'branch:read'),
  ('accountant', 'member:read'), ('accountant', 'audit:read'),
  ('viewer', 'business:read'), ('viewer', 'branch:read'),
  ('viewer', 'terminal:read'), ('viewer', 'member:read'),
  ('viewer', 'role:read');

WITH desired AS (
  SELECT r."id" AS role_id, g.permission_key
    FROM seed_system_grants g
    JOIN "roles" r ON r."business_id" IS NULL AND r."is_system" AND r."key" = g.role_key
),
added AS (
  INSERT INTO "role_permissions" ("role_id", "permission_key")
  SELECT role_id, permission_key FROM desired
  ON CONFLICT DO NOTHING
  RETURNING "role_id"
),
removed AS (
  DELETE FROM "role_permissions" rp
   USING "roles" r
   WHERE rp."role_id" = r."id"
     AND r."business_id" IS NULL AND r."is_system"
     AND r."key" IN (SELECT key FROM seed_system_roles)
     AND NOT EXISTS (
       SELECT 1 FROM desired d
        WHERE d.role_id = rp."role_id" AND d.permission_key = rp."permission_key"
     )
  RETURNING rp."role_id"
)
-- Roles created by this run (created_at = transaction start) stay at version 1.
UPDATE "roles"
   SET "version" = "version" + 1, "updated_at" = now()
 WHERE "id" IN (SELECT "role_id" FROM added UNION SELECT "role_id" FROM removed)
   AND "created_at" < now();

-- 4. Verify -------------------------------------------------------------------
-- Fails the transaction (nothing is kept) if the result is not what this file
-- declares, e.g. a grant naming a permission missing from the catalogue.
DO $$
DECLARE
  v_problem text;
BEGIN
  SELECT string_agg(format('%s -> %s', g.role_key, g.permission_key), ', ')
    INTO v_problem
    FROM seed_system_grants g
   WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."key" = g.permission_key);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'Seed grants reference unknown permissions: %', v_problem;
  END IF;

  SELECT string_agg(s.key, ', ')
    INTO v_problem
    FROM seed_system_roles s
   WHERE NOT EXISTS (
     SELECT 1 FROM "roles" r WHERE r."business_id" IS NULL AND r."is_system" AND r."key" = s.key
   );
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'System roles missing after seeding: %', v_problem;
  END IF;

  SELECT string_agg(format('%s (expected %s, found %s)', e.role_key, e.expected, coalesce(f.found, 0)), ', ')
    INTO v_problem
    FROM (SELECT role_key, count(*) AS expected FROM seed_system_grants GROUP BY role_key) e
    LEFT JOIN (
      SELECT r."key" AS role_key, count(*) AS found
        FROM "role_permissions" rp
        JOIN "roles" r ON r."id" = rp."role_id"
       WHERE r."business_id" IS NULL AND r."is_system"
       GROUP BY r."key"
    ) f ON f.role_key = e.role_key
   WHERE e.expected <> coalesce(f.found, 0);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'System role grants out of sync: %', v_problem;
  END IF;
END
$$;
