-- Seeds the permission catalogue and the system roles, and carries existing
-- authorization data over to role_permissions. Runs once (Drizzle ledger);
-- the inserts tolerate rows that already exist.
-- The catalogue must equal src/authorization/permission.constant.ts (a db spec
-- checks this). Adding a permission = a new migration like this one.

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
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";
--> statement-breakpoint

-- Every existing role gets a stable key derived from its name (unique per
-- business; duplicates get a numeric suffix).
WITH slugs AS (
  SELECT r."id",
         r."business_id",
         coalesce(
           nullif(btrim(regexp_replace(lower(r."name"), '[^a-z0-9]+', '-', 'g'), '-'), ''),
           'role'
         ) AS slug
    FROM "roles" r
   WHERE r."key" IS NULL
),
numbered AS (
  SELECT s."id",
         s.slug,
         row_number() OVER (
           PARTITION BY coalesce(s."business_id", '00000000-0000-0000-0000-000000000000'::uuid), s.slug
           ORDER BY s."id"
         ) AS n
    FROM slugs s
)
UPDATE "roles" r
   SET "key" = CASE WHEN numbered.n = 1 THEN numbered.slug ELSE numbered.slug || '-' || numbered.n END
  FROM numbered
 WHERE r."id" = numbered."id";
--> statement-breakpoint

-- System roles (shared by every business, read-only).
INSERT INTO "roles" ("business_id", "key", "name", "description", "is_system")
SELECT NULL, v.key, v.name, v.description, true
  FROM (VALUES
    ('admin', 'Admin', 'Everything the owner can do except ownership'),
    ('branch-manager', 'Branch manager', 'Runs a branch: terminals, staff and invitations'),
    ('cashier', 'Cashier', 'Sells at a terminal'),
    ('inventory-manager', 'Inventory manager', 'Manages stock'),
    ('accountant', 'Accountant', 'Reads finances and audit logs'),
    ('viewer', 'Viewer', 'Read-only access')
  ) AS v(key, name, description)
 WHERE NOT EXISTS (
   SELECT 1 FROM "roles" r WHERE r."business_id" IS NULL AND r."key" = v.key
 );
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT r."id", g.permission_key
  FROM (VALUES
    ('admin', 'business:read'), ('admin', 'business:update'),
    ('admin', 'branch:read'), ('admin', 'branch:update'),
    ('admin', 'terminal:read'), ('admin', 'terminal:activate'),
    ('admin', 'terminal:update'), ('admin', 'terminal:revoke'),
    ('admin', 'member:read'), ('admin', 'member:invite'),
    ('admin', 'member:update'), ('admin', 'member:end'),
    ('admin', 'role:read'), ('admin', 'role:create'),
    ('admin', 'role:update'), ('admin', 'role:delete'),
    ('admin', 'override:manage'), ('admin', 'audit:read'),
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
    ('viewer', 'role:read')
  ) AS g(role_key, permission_key)
  JOIN "roles" r ON r."business_id" IS NULL AND r."is_system" AND r."key" = g.role_key
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Carry over custom role grants from the deprecated roles.permissions jsonb
-- ("business.read", "branches.read", ...); unknown entries are dropped.
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT DISTINCT r."id", p."key"
  FROM "roles" r
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(r."permissions") = 'array' THEN r."permissions" ELSE '[]'::jsonb END
  ) AS e(value)
  JOIN "permissions" p
    ON p."key" = regexp_replace(replace(e.value, '.', ':'), '^branches:', 'branch:')
 WHERE NOT r."is_system"
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Carry over endpoint_role_access (removed later): an endpoint mapped to a role
-- becomes the matching permission on that role.
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT DISTINCT a."role_id", p."key"
  FROM "endpoint_role_access" a
  JOIN "roles" r ON r."id" = a."role_id" AND NOT r."is_system"
  JOIN "permissions" p
    ON p."key" = regexp_replace(replace(a."endpoint_key", '.', ':'), '^branches:', 'branch:')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Platform roles: the bootstrap user is admin; existing staff keep what they can
-- do today (manager: read, provision, create branches).
UPDATE "platform_users" SET "role" = CASE WHEN "is_bootstrap" THEN 'admin' ELSE 'manager' END;
