# platform

Routes used by Fortis staff (platform users) and the public business-enquiry form.
Platform users are a separate identity from business users (`platform_users`).

## Endpoints (prefix `/api/v1`)

| Method | Path                                                 | Auth                               | Notes                                                                            |
| ------ | ---------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| GET    | `/platform`                                          | platform user                      | Paginated business directory (active + inactive)                                 |
| GET    | `/platform/business/:business_id`                    | platform user                      | Business, branches, memberships. Requires `x-client-type` web/mobile/desktop     |
| GET    | `/platform/business/:business_id/:branch_id`         | platform user                      | Branch, terminals, active employees                                              |
| POST   | `/platform/businesses/create?requested_business_id=` | platform user, `Idempotency-Key`   | Provision a business from a reviewed request; queues the owner redeem-code email |
| POST   | `/platform/businesses/:businessId/branches`          | platform user, `Idempotency-Key`   | Create a branch and its terminals; emails active owners                          |
| POST   | `/platform/businesses/request`                       | public, web only, rate limited     | Multipart enquiry with PAN front/back and registration certificate               |
| POST   | `/platform/users/invite`                             | platform user, `x-idempotency-key` | Invite another platform user                                                     |

## Rules

- Platform routes check today that the JWT is a platform token (`requirePlatformUserId`). Per-route platform permissions arrive with the authorization refactor.
- Writes that may be retried are idempotent through Redis (`idempotency:{actor}:{operation}:{keyHash}`), and a different payload for the same key returns 409.
- Provisioning, branch creation and invitations write their audit row and outbox email in the same transaction as the data.
- A public business request never creates a business. Staff review it, then provision it.

## Layout

| Route group       | Controller                          | Service                          | Repository                          |
| ----------------- | ----------------------------------- | -------------------------------- | ----------------------------------- |
| Businesses        | `platform-businesses.controller.ts` | `platform-businesses.service.ts` | `platform-businesses.repository.ts` |
| Business requests | `business-requests.controller.ts`   | `business-requests.service.ts`   | `business-requests.repository.ts`   |
| Platform users    | `platform-users.controller.ts`      | `platform-users.service.ts`      | `platform-users.repository.ts`      |

All SQL lives in the repositories. `mail-outbox.publisher.ts` relays the mail outbox to RabbitMQ; the BullMQ migration replaces it.

## Tests

Unit tests are in `test/`. E2E tests are in `../../test/platform/`.
