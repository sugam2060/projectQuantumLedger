# authorization

Permission checks for business users and Fortis staff. Business permissions are
decided **in the database** by `app.has_permission`, so the API guard and the RLS
policies always agree.

## Using it on a route

```ts
@Get(':businessId/branches/:branchId')
@RequiredPermission(Permission.BRANCH_READ)
getBranch(@BusinessId() businessId: string, @BranchId() branchId: string) {}

@Post('businesses/create')
@RequiredPlatformPermission(PlatformPermission.BUSINESS_PROVISION)
provision() {}

@Post('logout-all')
@SelfService() // acts only on the caller's own account; no permission needed
logoutAll() {}
```

- `@RequiredPermission(...)` needs a `:businessId` route parameter. When the route
  also has `:branchId`, the check is made at that branch.
- `@BusinessId()` / `@BranchId()` return the ids the guard validated (lowercase
  UUIDs). Use them instead of `@Param()`.
- Never use raw permission strings: use `Permission.X` / `PlatformPermission.X`.

## PermissionGuard (global, registered last in AppModule)

| Situation                                                                                                                | Response                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| no requirement, or `@Public()`                                                                                           | pass                                                                 |
| no authenticated user                                                                                                    | 401                                                                  |
| `:businessId` / `:branchId` not a UUID                                                                                   | 400                                                                  |
| platform token on a business permission (or the reverse), no membership, missing permission, other branch, deny override | 403 `You do not have permission for this action` (same body for all) |
| `@RequiredPermission` on a route without `:businessId`                                                                   | 500 (the route audit test catches this first)                        |

## How `app.has_permission(business, branch, key)` decides

1. Unknown key, no user, no active membership, or disabled account → **deny**.
2. Active owner → **allow** (every key).
3. Branch limit = membership `branch_id`, else the role's `branch_id`. A check at
   another branch → **deny**. Business-wide checks (no branch) are not limited.
4. Deny override for the member → **deny**.
5. Allow override → **allow**.
6. The member's role grants it (`role_permissions`; system roles or a role of that
   business only) → **allow**; otherwise deny.

Related SQL (`script/sql/02-security-functions.sql`): `app.has_all_permissions`
(used by the guard: one query), `app.effective_permissions` (returned on sign-in
and by `/authentication/me`), and `app.can_manage_role` (RLS on `role_permissions`).
RLS policies on business, branches, terminals, memberships, invitations, roles and
audit/access logs call `app.has_permission` too.

## Data

- `permissions`: the catalogue. Seeded by migrations, read-only for `fortis_app`,
  and must equal `PERMISSION_KEYS` (checked by `test/authorization/permissions.db-spec.ts`).
- `roles`: system roles (`business_id IS NULL`, `is_system`, read-only) and custom
  roles of one business (optionally limited to a branch with `branch_id`). `key` is
  a slug unique per business.
- `role_permissions`: grants of a role.
- `member_permission_overrides`: per-member `allow` / `deny` of one key.

Seeded system roles (migration 0022):

| Role                | Permissions                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `admin`             | everything                                                                                                                |
| `branch-manager`    | business:read, branch:read/update, terminal:read/activate/update/revoke, member:read/invite/update, role:read, audit:read |
| `cashier`           | business:read, branch:read, terminal:read                                                                                 |
| `inventory-manager` | business:read, branch:read, terminal:read                                                                                 |
| `accountant`        | business:read, branch:read, member:read, audit:read                                                                       |
| `viewer`            | business:read, branch:read, terminal:read, member:read, role:read                                                         |

Migration 0022 also carried existing grants over: the old `roles.permissions` jsonb
and `endpoint_role_access` rows (`business.read` → `business:read`,
`branches.read` → `branch:read`, ...). Migration 0024 then dropped both.

### Adding a permission

1. Add it to `Permission` in `permission.constant.ts`.
2. Add a custom migration (`npx drizzle-kit generate --custom`) that inserts the
   `permissions` row and the `role_permissions` rows for system roles that get it.
3. `npm run test:db`: the catalogue test fails until both match.

## Platform permissions

Staff permissions are not stored per user. `platform_users.role` (`admin`,
`manager`, `support`) maps to a fixed set in `platform-permission.constant.ts`;
bootstrap users always act as `admin`. The role is a claim in the platform access
token, so a role change applies at the next refresh (at most 15 minutes). Existing
staff were migrated to `manager` (bootstrap: `admin`); new rows default to `support`.

| Role      | Permissions                               |
| --------- | ----------------------------------------- |
| `admin`   | all                                       |
| `manager` | business read, provision, create branches |
| `support` | business read                             |

## Route audit

`test/authorization/route-audit.e2e-spec.ts` inspects every route and fails when:

- a `:businessId` route has no `@RequiredPermission`;
- a `@PlatformRoute()` has no `@RequiredPlatformPermission` and is not `@SelfService()`;
- a public route names a business or carries a permission;
- a business permission is on a platform route or the reverse.

The rules are a pure function (`utils/route-audit.util.ts`) with unit tests.

## Tests

- Unit: `test/permission.guard.spec.ts` (401/400/403 matrix), `test/permission.service.spec.ts`, `test/route-audit.util.spec.ts`.
- Database (`npm run test:db`): `test/authorization/permissions.db-spec.ts`: catalogue drift, system roles, the `has_permission` matrix as `fortis_app`, and full-stack checks (cashier read vs edit, effective permissions, cross-business 403, branch-scoped terminal activation, platform roles).
