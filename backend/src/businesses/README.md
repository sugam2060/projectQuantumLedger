# businesses

The tenant side of a business, as used by business users (owners and staff):
profile, branches, terminals, roles, members and invitations.

Every `:businessId` route needs a permission (`@RequiredPermission`), decided in
the database by `app.has_permission` (see `../authorization/README.md`).

## Endpoints (prefix `/api/v1`)

`[/branches/:branchId]` marks routes that also exist under
`/businesses/:businessId/branches/:branchId/...`. On that form the permission is
checked **at the branch**, only that branch's members and invitations are
visible, and people can only be placed in that branch. Branch managers (members
limited to one branch) must use it: business-wide checks fail for them, except
`business:read`, `branch:read` and `role:read`.

| Method | Path                                                                            | Permission                        | Notes                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/businesses/:businessId`                                                       | `business:read`                   | Profile                                                                                                                                          |
| PATCH  | `/businesses/:businessId`                                                       | `business:update`                 | Multipart profile fields + optional documents; `Idempotency-Key`. Audited                                                                        |
| GET    | `/businesses/:businessId/branches`                                              | `branch:read`                     | Keyset pagination; branch-limited members see only their branch                                                                                  |
| GET    | `/businesses/:businessId/branches/:branchId`                                    | `branch:read` at the branch       | Branch + terminal and member counts                                                                                                              |
| POST   | `/businesses/:businessId/branches/:branchId/terminals/activate`                 | `terminal:activate` at the branch | Activates an inactive terminal by its code. Audited                                                                                              |
| GET    | `/permissions`                                                                  | signed in                         | Permission catalogue (key + description)                                                                                                         |
| GET    | `/businesses/:businessId/roles`                                                 | `role:read`                       | System roles + the business's roles, with their permissions                                                                                      |
| GET    | `/businesses/:businessId/roles/:roleId`                                         | `role:read`                       |                                                                                                                                                  |
| POST   | `/businesses/:businessId/roles`                                                 | `role:create`                     | `{ name, description?, branchId?, permissions[] }`; key derived from the name; 409 if taken                                                      |
| PATCH  | `/businesses/:businessId/roles/:roleId`                                         | `role:update`                     | Only sent fields change; `version` increases on every edit                                                                                       |
| DELETE | `/businesses/:businessId/roles/:roleId`                                         | `role:delete`                     | 204; 409 while active members or open invitations use it                                                                                         |
| GET    | `/businesses/:businessId[/branches/:branchId]/members`                          | `member:read`                     | Active members                                                                                                                                   |
| GET    | `/businesses/:businessId[/branches/:branchId]/members/:userId`                  | `member:read`                     | + overrides and effective permissions                                                                                                            |
| PATCH  | `/businesses/:businessId[/branches/:branchId]/members/:userId`                  | `member:update`                   | `{ roleId?, branchId? }` (`branchId: null` = business-wide). A branch move signs the member out                                                  |
| POST   | `/businesses/:businessId[/branches/:branchId]/members/:userId/end-membership`   | `member:end`                      | 204. Overrides removed, every session revoked                                                                                                    |
| PUT    | `/businesses/:businessId/members/:userId/overrides/:permissionKey`              | `override:manage`                 | `{ effect: 'allow' \| 'deny' }`                                                                                                                  |
| DELETE | `/businesses/:businessId/members/:userId/overrides/:permissionKey`              | `override:manage`                 | 204                                                                                                                                              |
| POST   | `/businesses/:businessId[/branches/:branchId]/invitations`                      | `member:invite`                   | `{ emails[1..20], roleId, branchId? }` → 200 with one status per address: `invited`, `already_member`, `already_invited`, `invalid`, `forbidden` |
| GET    | `/businesses/:businessId[/branches/:branchId]/invitations`                      | `member:read`                     | Latest 200 with status `open` / `expired` / `accepted` / `revoked`                                                                               |
| POST   | `/businesses/:businessId[/branches/:branchId]/invitations/:invitationId/resend` | `member:invite`                   | New token and expiry; the old link stops working                                                                                                 |
| DELETE | `/businesses/:businessId[/branches/:branchId]/invitations/:invitationId`        | `member:invite`                   | 204                                                                                                                                              |
| GET    | `/invitations/preview?token=`                                                   | public, strict throttle           | Business, role, branch, expiry, whether the email already has an account. 404 if unusable                                                        |
| POST   | `/invitations/accept`                                                           | public, strict throttle           | `{ token, password, name?, confirmResignation? }`, see below                                                                                     |

## Anti-escalation rules (enforced in SQL, `script/sql/02-security-functions.sql`)

Business users never write memberships, roles, role grants, overrides or
invitations directly: RLS and grants block it. Every change goes through a
SECURITY DEFINER function that re-checks the caller's permission and:

- nobody changes their own membership, role or overrides, and nobody touches the owner;
- nobody manages a member who holds a permission they lack;
- nobody hands out a permission they lack: assigning a role, inviting with a
  role, an `allow` override, lifting a `deny` override, or putting it into a role;
- nobody edits or deletes a role that grants something they lack;
- a branch-level role works only at its branch; branch routes place people only
  in that branch, and other branches' members look like they do not exist (404);
- system roles are read-only.

The functions return an outcome (`ok`, `not_found`, `forbidden`, `invalid`,
`conflict`); `utils/outcome.util.ts` maps it to HTTP (403 uses the guard's
generic message).

## Accepting an invitation

`app.accept_business_invitation` decides it, locking the invitation row, and
the token works once.

- If the email already has an account, send its password. The API verifies it
  first (dummy verify on unknown tokens).
- A new account sends `name` + `password` (10–128 characters).
- An active member of another business gets 409 unless `confirmResignation:
true`. That ends the old membership and signs them out everywhere.
- Owners of another business always get 409.
- Every other failure is one generic 400.
- The response is `{ businessId, userId, accountCreated }`. The person then
  signs in normally.

## Other rules

- Branch cursors are bound to the filters that produced them; reuse under other filters is 400.
- Profile updates upload documents first and delete them again if the transaction fails.
- Invitation tokens are 32 random bytes; only the SHA-256 is stored. Emails go
  through the BullMQ `email` queue after commit; a failed enqueue is logged and
  the invitation can be resent.

## Layout

| Route group             | Controller                     | Service                                 | Repository                  |
| ----------------------- | ------------------------------ | --------------------------------------- | --------------------------- |
| Profile                 | `businesses.controller.ts`     | `businesses.service.ts` (+ idempotency) | `businesses.repository.ts`  |
| Branches                | `branches.controller.ts`       | `branches.service.ts`                   | `branches.repository.ts`    |
| Terminals               | `terminals.controller.ts`      | `terminals.service.ts`                  | `terminals.repository.ts`   |
| Roles                   | `roles.controller.ts`          | `roles.service.ts`                      | `roles.repository.ts`       |
| Members                 | `members.controller.ts`        | `members.service.ts`                    | `members.repository.ts`     |
| Invitations             | `invitations.controller.ts`    | `invitations.service.ts`                | `invitations.repository.ts` |
| Public invitation links | `my-invitations.controller.ts` | `my-invitations.service.ts`             | `invitations.repository.ts` |

## Tests

- Unit: `test/` (including `team.services.spec.ts`).
- E2E: `../../test/businesses/`.
- Database (`npm run test:db`): `../../test/businesses/team.db-spec.ts` covers roles, member changes, branch managers, overrides, direct-write blocking, invitations end to end and platform staff invitations.
