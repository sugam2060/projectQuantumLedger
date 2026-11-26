# platform

Routes used by Fortis staff (platform users) and the public business-enquiry form.
Platform users are a separate identity from business users (`platform_users`).

## Endpoints (prefix `/api/v1`)

| Method | Path                                                 | Auth                           | Notes                                                                                                                                    |
| ------ | ---------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/platform`                                          | `platform:business:read`       | Paginated business directory (active + inactive)                                                                                         |
| GET    | `/platform/business/:business_id`                    | `platform:business:read`       | Business, branches, memberships. Requires `x-client-type` web/mobile/desktop                                                             |
| GET    | `/platform/business/:business_id/:branch_id`         | `platform:business:read`       | Branch, terminals, active employees                                                                                                      |
| POST   | `/platform/businesses/create?requested_business_id=` | `platform:business:provision`  | Provision a business from a reviewed request; queues the owner redeem-code email                                                         |
| POST   | `/platform/businesses/:businessId/branches`          | `platform:branch:create`       | Create a branch and its terminals; emails active owners                                                                                  |
| POST   | `/platform/businesses/request`                       | public, web only, rate limited | Multipart enquiry with PAN front/back and registration certificate                                                                       |
| POST   | `/platform/users/invite`                             | `platform:user:invite`         | `{ name, email, role? }` (role defaults to `support`); `x-idempotency-key`. Emails a single-use link to `/platform/accept-invite?token=` |
| POST   | `/platform/users/invitations/accept`                 | public, strict throttle        | `{ token, password }` creates the staff account with the invited name and role. One generic 400 otherwise                                |

## Rules

- Every platform route needs a platform permission (`@RequiredPlatformPermission`), derived from the staff member's role (`admin`, `manager`, `support`; bootstrap = admin). See `../authorization/README.md`.
- Staff invitation links carry a random token; only its SHA-256 is stored (the old links used the stored hash itself as the secret). Acceptance is decided by `app.accept_platform_invitation`.
- Writes that may be retried are idempotent through Redis (`idempotency:{actor}:{operation}:{keyHash}`), and a different payload for the same key returns 409.
- Provisioning, branch creation and invitations write their audit row in the same transaction as the data; emails are enqueued on the BullMQ `email` queue after commit (failures logged).
- A public business request never creates a business. Staff review it, then provision it.

## Layout

| Route group       | Controller                          | Service                          | Repository                          |
| ----------------- | ----------------------------------- | -------------------------------- | ----------------------------------- |
| Businesses        | `platform-businesses.controller.ts` | `platform-businesses.service.ts` | `platform-businesses.repository.ts` |
| Business requests | `business-requests.controller.ts`   | `business-requests.service.ts`   | `business-requests.repository.ts`   |
| Platform users    | `platform-users.controller.ts`      | `platform-users.service.ts`      | `platform-users.repository.ts`      |

All SQL lives in the repositories.

## Tests

Unit tests are in `test/`. E2E tests are in `../../test/platform/`.
