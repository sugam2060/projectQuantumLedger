# businesses

The tenant side of a business: profile, branches and terminals, as used by business users (owners and staff).

## Endpoints (prefix `/api/v1`)

| Method | Path                                                            | Who                      | Notes                                                                                            |
| ------ | --------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| GET    | `/businesses/:businessId`                                       | owner of that business   | Profile                                                                                          |
| PATCH  | `/businesses/:businessId`                                       | owner, `Idempotency-Key` | Multipart: profile fields + optional PAN/registration documents. Audited                         |
| GET    | `/businesses/:businessId/branches`                              | members of the business  | Keyset pagination (`limit`, `cursor`, `from`, `to`); branch-scoped members see only their branch |
| GET    | `/businesses/:businessId/branches/:branchId`                    | members                  | Branch plus terminal and member counts; out-of-scope branch returns 404                          |
| POST   | `/businesses/:businessId/branches/:branchId/terminals/activate` | owner                    | Activates an inactive terminal by its code. Audited                                              |

## Rules

- The business id in the path must match the caller's token. Controllers check this today with `utils/business-access.util.ts`; the authorization refactor replaces it with `@RequiredPermission`.
- Services check the active membership in the database again, inside the RLS transaction.
- Branch cursors are bound to the filters that produced them; reusing one under other filters returns 400.
- Profile updates upload documents first and delete them again if the transaction fails. Replaced documents are deleted only after commit.

## Layout

| Route group | Controller                 | Service                                                              | Repository                 |
| ----------- | -------------------------- | -------------------------------------------------------------------- | -------------------------- |
| Profile     | `businesses.controller.ts` | `businesses.service.ts` (+ `business-update-idempotency.service.ts`) | `businesses.repository.ts` |
| Branches    | `branches.controller.ts`   | `branches.service.ts`                                                | `branches.repository.ts`   |
| Terminals   | `terminals.controller.ts`  | `terminals.service.ts`                                               | `terminals.repository.ts`  |

Pure helpers live in `utils/` (branch cursors, update input normalisation, access checks). All SQL lives in the repositories.

## Tests

Unit tests are in `test/`. E2E tests are in `../../test/businesses/`.
