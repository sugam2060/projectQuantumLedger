# API Endpoint Details

The backend adds `/api/v1` as a global prefix. The endpoint paths below include
that prefix. UUIDs in examples are illustrative; credentials and tokens are
redacted. This document describes the HTTP routes currently declared by the
controllers.

## Application

### `GET /api/v1/`

**Description:** Health-independent greeting endpoint used to confirm that the
API process is responding. **Auth:** public. **Rate limit:** none. **Errors:**
none specific to the handler. **Idempotency:** read-only.

```json
{
  "phase": 1,
  "endpoint": "GET /api/v1/",
  "requestData": {
    "pathParams": {},
    "queryParams": null,
    "headers": {},
    "body": null
  },
  "responseData": {
    "httpStatus": 200,
    "body": "Hello World!"
  }
}
```

### `POST /api/v1/onboarding`

**Description:** Accepts an onboarding event payload, acknowledges it, and logs
the received object. The current handler does not persist the payload.
**Auth:** signed-in user (JWT). **Rate limit:** none. **Errors:** 400 for a
missing, non-object, or array body; 401 if authentication fails.
**Idempotency:** no idempotency key is supported; the handler only acknowledges
and logs each request.

```json
{
  "phase": 1,
  "endpoint": "POST /api/v1/onboarding",
  "requestData": {
    "pathParams": {},
    "queryParams": null,
    "headers": {
      "Authorization": "Bearer <access-token>",
      "Content-Type": "application/json"
    },
    "body": {
      "event": "business.created",
      "businessName": "Example Store"
    }
  },
  "responseData": {
    "httpStatus": 202,
    "body": {
      "acknowledged": true,
      "message": "Onboarding data received."
    }
  }
}
```

## User authentication

### `POST /api/v1/authentication/logout`

**Description:** Ends the authenticated session by deleting its refresh token
from Redis when a refresh token is supplied and belongs to the authenticated
user. Web clients may use the `refresh_token` cookie; desktop and mobile
clients may send `refreshToken` in the JSON body and clear their locally stored
tokens themselves. Web logout clears the `access_token` and `refresh_token`
cookies. **Auth:** signed-in user or platform user (JWT). **Errors:** 400 for
an invalid `x-client-type`; 401 for a missing or invalid access token.
**Idempotency:** safe to repeat; a missing or already revoked refresh token
does not prevent a successful response.

```json
{
  "phase": 1,
  "endpoint": "POST /api/v1/authentication/logout",
  "requestData": {
    "pathParams": {},
    "queryParams": null,
    "headers": {
      "Authorization": "Bearer <access-token>",
      "x-client-type": "web",
      "Content-Type": "application/json"
    },
    "body": null
  },
  "responseData": {
    "httpStatus": 200,
    "body": {
      "revoked": true
    }
  }
}
```

For desktop and mobile clients, include the current `refreshToken` in the
request body if it should also be revoked server-side:

```json
{
  "refreshToken": "<redacted>"
}
```

### `POST /api/v1/authentication/login`

**Description:** Authenticates a business user with email and password, then
returns their profile and active business memberships. An access token includes
business/role claims for the active business membership.
**Auth:** public. **Rate limit:** 100 requests per hour, with dynamic
adjustment enabled. **Errors:** 400 for invalid input, 401 for invalid
credentials or an inactive/unassigned terminal or missing active business membership, 429 when rate limited. Mobile/desktop requests missing `x-terminal-id` receive 400.
**Idempotency:** no; a login creates a new access token and may create a refresh
token.

`remember` is optional. For `mobile` and `desktop`, `x-terminal-id` is required and must identify an active terminal matching the user's business membership. Web clients may omit it; without the header, the token uses the membership's branch assignment (or no branch for a business-wide manager). If a web client supplies a terminal ID, it is validated and the token is bound to that terminal's branch. The JWT includes the user's name and business/branch
context; role claims are included when the membership has a role. A business
owner may have `roleId: null`; the response then has an empty effective
permission list because owners bypass endpoint role mappings. Non-owner
memberships must have a role. The JWT omits duplicate `userId`, email,
permissions, and terminal ID claims. Effective permissions for role-based
members are returned as a separate response field for the client to cache.
`x-client-type` may be `web`,
`desktop`, or `mobile`; if
omitted, it defaults to `web`. With `remember: true`, the response includes a
refresh token and the access token expires in `7d`; otherwise it expires in
`15m`. Web clients receive HTTP-only token cookies and the body omits token
fields. Mobile and desktop clients receive tokens in the JSON body.

```json
{
  "phase": 1,
  "endpoint": "POST /api/v1/authentication/login",
  "requestData": {
    "pathParams": {},
    "queryParams": null,
    "headers": {
      "Content-Type": "application/json",
      "x-client-type": "desktop",
      "x-terminal-id": "01234567-89ab-4cde-8f01-23456789abcd"
    },
    "body": {
      "email": "cashier@example.com",
      "password": "<redacted>",
      "remember": true
    }
  },
  "responseData": {
    "httpStatus": 200,
    "body": {
      "accessToken": "<redacted>",
      "refreshToken": "<redacted>",
      "tokenType": "Bearer",
      "expiresIn": "7d",
      "user": {
        "id": "45fbee7a-f45f-4738-96bc-32f90a5e34b3",
        "email": "cashier@example.com",
        "name": "Cashier One"
      },
      "memberships": [
        {
          "businessId": "8b6dd8d2-53d4-4f52-87a1-5e8187423d56",
          "branchId": "01234567-89ab-4cde-8f01-23456789abcd",
          "isOwner": false,
          "roleId": "9abcde01-2345-4f67-89ab-cdef01234567",
          "role": "Cashier",
          "roleVersion": 3
        }
      ],
      "effectivePermissions": ["inventory.create", "products.read"]
    }
  }
}
```

### `POST /api/v1/authentication/refresh`

**Description:** Rotates a user's refresh token and issues a new access token.
Web clients may send the refresh token in the `refresh_token` cookie; other
clients send it in the JSON body. **Auth:** public; possession of a valid
refresh token is required. **Rate limit:** none currently. **Errors:** 400 for
invalid headers (including a missing `x-terminal-id` for mobile/desktop), 401 for a missing/invalid refresh token, no active membership, or an inactive/unassigned terminal. **Idempotency:** no; tokens
rotate, so a refresh token should only be used once.

The `x-client-type` header controls web behavior. For web, the controller sets
new HTTP-only cookies and omits the tokens from the response body. For desktop
and mobile, tokens are returned in JSON. For mobile and desktop, `x-terminal-id` is required and must be active and match the user's membership. Web clients may omit it; refresh then uses the sole active membership and its assigned branch (or business-wide scope). A supplied terminal is still validated. The server issues a token with the current role ID and version. Owners with a role-free membership can also
refresh; their response has an empty effective-permission list and the token
omits role claims. Non-owners need an assigned role. The effective permission
snapshot is returned separately from the JWT so the client can refresh its
permission cache.

```json
{
  "phase": 1,
  "endpoint": "POST /api/v1/authentication/refresh",
  "requestData": {
    "pathParams": {},
    "queryParams": null,
    "headers": {
      "Content-Type": "application/json",
      "x-client-type": "mobile",
      "x-terminal-id": "01234567-89ab-4cde-8f01-23456789abcd"
    },
    "body": {
      "refreshToken": "<redacted>"
    }
  },
  "responseData": {
    "httpStatus": 200,
    "body": {
      "accessToken": "<redacted>",
      "refreshToken": "<redacted>",
      "tokenType": "Bearer",
      "expiresIn": "15m",
      "user": {
        "id": "45fbee7a-f45f-4738-96bc-32f90a5e34b3",
        "email": "cashier@example.com",
        "name": "Cashier One"
      },
      "effectivePermissions": ["inventory.create", "products.read"]
    }
  }
}
```

### `GET /api/v1/authentication/me`

**Description:** Returns the signed-in user's profile, active business/branch
context, owner status, current role template and version, and JWT session
summary from the validated access token. `x-initial-load` defaults to `true`;
when true, the endpoint also returns effective permissions, using Redis first
and querying the role and endpoint configuration from the database on a cache
miss. When false, the permission field is omitted and no permission lookup is
performed. The profile fields continue to come from the JWT. For mobile and desktop, `x-terminal-id` is required; web clients may omit it. It is session metadata and is not revalidated by this endpoint. When omitted, `session.terminalId` is null. A
token without a business context can return a null active context and role. For
a role-free owner, `role_template` and `role_template_version` are null, and
initial-load permissions are an empty array.
**Auth:** signed-in
business user; platform-user tokens are rejected. **Rate limit:** 60 requests
per minute. **Permission:** no endpoint role required. **Errors:** 400 for
invalid headers, 401 for invalid or incomplete user claims, 429 when rate
limited. **Idempotency:** read-only.

```json
{
  "phase": 1,
  "endpoint": "GET /api/v1/authentication/me",
  "requestData": {
    "pathParams": {},
    "queryParams": null,
    "headers": {
      "Authorization": "Bearer <access-token>",
      "x-client-type": "web",
      "x-initial-load": "true"
    },
    "body": null
  },
  "responseData": {
    "httpStatus": 200,
    "body": {
      "user": {
        "id": "45fbee7a-f45f-4738-96bc-32f90a5e34b3",
        "name": "Cashier One"
      },
      "activeContext": {
        "businessId": "8b6dd8d2-53d4-4f52-87a1-5e8187423d56",
        "branchId": "01234567-89ab-4cde-8f01-23456789abcd"
      },
      "is_owner": false,
      "role_template": "9abcde01-2345-4f67-89ab-cdef01234567",
      "role_template_version": "3",
      "effectivePermissions": ["inventory.create", "products.read"],
      "session": {
        "clientType": "web",
        "terminalId": null,
        "issuedAt": "2026-11-13T02:15:00.000Z",
        "expiresAt": "2026-11-13T02:30:00.000Z",
        "expiresInSeconds": 900
      }
    }
  }
}
```

## Platform authentication

### `GET /api/v1/platform/businesses`

**Description:** Returns a paginated, newest-first directory of businesses
registered on the platform, including both active and inactive businesses.
The response contains basic business and primary contact details and does not
include PAN values or document URLs. **Auth:** signed-in platform manager
(platform-user JWT); `Authorization` and `x-client-type` headers are required,
and `x-client-type` must be `web`, `desktop`, or `mobile`. **Errors:** 400 for
invalid pagination or client-type headers; 401 when the access token is missing
or invalid; 403 for a non-platform user. **Audit:** none for this read.
**Pagination:** `page` defaults to 1;
`limit` defaults to 20 and is capped at 100. **Success:** 200.

```json
{
  "phase": 1,
  "endpoint": "GET /api/v1/platform/businesses",
  "requestData": {
    "pathParams": {},
    "queryParams": {
      "page": 1,
      "limit": 20
    },
    "headers": {
      "Authorization": "Bearer <platform-access-token>",
      "x-client-type": "web"
    },
    "body": null
  },
  "responseData": {
    "httpStatus": 200,
    "body": {
      "data": [
        {
          "id": "8b6dd8d2-53d4-4f52-87a1-5e8187423d56",
          "legalName": "Example Retail Pvt. Ltd.",
          "displayName": "Example Retail",
          "isActive": true,
          "primaryContactNumber": "+9779812345678",
          "primaryContactEmail": "owner@example.com",
          "createdAt": "2026-11-13T02:15:00.000Z",
          "updatedAt": "2026-11-13T02:15:00.000Z"
        },
        {
          "id": "a8c6dd8d-2f52-4f52-87a1-5e8187423d56",
          "legalName": "Example Inactive Ltd.",
          "displayName": "Example Inactive",
          "isActive": false,
          "primaryContactNumber": "+9779812345679",
          "primaryContactEmail": "inactive@example.com",
          "createdAt": "2026-11-12T02:15:00.000Z",
          "updatedAt": "2026-11-12T02:15:00.000Z"
        }
      ],
      "pagination": {
        "page": 1,
        "limit": 20,
        "total": 2,
        "totalPages": 1
      }
    }
  }
}
```

### `GET /api/v1/platform/business/{business_id}`

**Description:** Returns the selected business, all of its branches (active and
inactive), and all business memberships (active and inactive). Memberships
include the associated user, role, and branch when present. **Auth:** signed-in
platform manager (platform-user JWT); `Authorization` and `x-client-type`
headers are required, and `x-client-type` must be `web`, `desktop`, or
`mobile`. **Audit:** none for this read. **Errors:** 400 for an invalid business
UUID or client-type header; 401 when the access token is missing or invalid; 403
for a non-platform user; 404 when the business does not exist. **Success:** 200.

```json
{
  "phase": 1,
  "endpoint": "GET /api/v1/platform/business/{business_id}",
  "requestData": {
    "pathParams": {
      "business_id": "8b6dd8d2-53d4-4f52-87a1-5e8187423d56"
    },
    "queryParams": null,
    "headers": {
      "Authorization": "Bearer <platform-access-token>",
      "x-client-type": "web"
    },
    "body": null
  },
  "responseData": {
    "httpStatus": 200,
    "body": {
      "business": {
        "id": "8b6dd8d2-53d4-4f52-87a1-5e8187423d56",
        "legalName": "Example Retail Pvt. Ltd.",
        "displayName": "Example Retail",
        "pan": "<business-pan>",
        "address": "Main Street, Kathmandu",
        "addressDetails": {
          "country": "NP",
          "city": "Kathmandu",
          "postalCode": "44600",
          "addressLine1": "Main Street",
          "addressLine2": null
        },
        "documents": {},
        "primaryContactNumber": "+9779812345678",
        "primaryContactEmail": "owner@example.com",
        "isActive": true,
        "createdBy": "a8c6dd8d-2f52-4f52-87a1-5e8187423d56",
        "createdAt": "2026-11-13T02:15:00.000Z",
        "updatedAt": "2026-11-13T02:15:00.000Z"
      },
      "branches": [
        {
          "id": "01234567-89ab-4cde-8f01-23456789abcd",
          "businessId": "8b6dd8d2-53d4-4f52-87a1-5e8187423d56",
          "name": "Main Branch",
          "code": "MAIN",
          "address": "Main Street",
          "contactNumber": "+9779812345678",
          "isActive": true,
          "createdAt": "2026-11-13T02:15:00.000Z",
          "updatedAt": "2026-11-13T02:15:00.000Z"
        }
      ],
      "memberships": [
        {
          "id": "c8c6dd8d-2f52-4f52-87a1-5e8187423d56",
          "isOwner": true,
          "isActive": true,
          "branchId": null,
          "roleId": null,
          "createdAt": "2026-11-13T02:15:00.000Z",
          "updatedAt": "2026-11-13T02:15:00.000Z",
          "user": {
            "id": "d8c6dd8d-2f52-4f52-87a1-5e8187423d56",
            "email": "owner@example.com",
            "name": "Example Owner",
            "status": "active"
          },
          "role": null,
          "branch": null
        }
      ]
    }
  }
}
```

### `POST /api/v1/platform/businesses/request`

**Description:** Submits a public business workspace provisioning request for
platform team verification. Send the application fields and all three document
files in a single multipart request. The server uploads documents to private,
authenticated Cloudinary storage and saves their IDs and secure URLs with the
application. **Auth:** public; only `x-client-type: web` is accepted.
**Rate limit:** 5 requests per hour. **Errors:** 400 for invalid request data,
missing/unsupported files, or a non-web client; 413 when a file exceeds 10 MB;
429 when rate limited; 500 for storage/database failures. **Idempotency:** no;
each accepted call creates a separate pending request. **Success:** 201.

```json
{
  "phase": 1,
  "endpoint": "POST /api/v1/platform/businesses/request",
  "requestData": {
    "pathParams": {},
    "queryParams": null,
    "headers": {
      "X-Client-Type": "web",
      "Content-Type": "multipart/form-data"
    },
    "body": {
      "legalName": "Example Retail Pvt. Ltd.",
      "displayName": "Example Retail",
      "country": "NP",
      "city": "Kathmandu",
      "postalCode": "123123123",
      "addressLine1": "Address line 1",
      "addressLine2": "Address line 2",
      "primaryContactName": "Example Owner",
      "primaryContactEmail": "owner@example.com",
      "primaryContactPhone": "+9779812345678",
      "panCardFront": "<JPEG, PNG, or PDF binary; maximum 10 MB>",
      "panCardBack": "<JPEG, PNG, or PDF binary; maximum 10 MB>",
      "businessRegistrationCertificate": "<JPEG, PNG, or PDF binary; maximum 10 MB>"
    }
  },
  "responseData": {
    "httpStatus": 201,
    "body": {
      "message": "Your request has been submitted. Our team will contact you for further process."
    }
  }
}
```

### `POST /api/v1/platform/businesses/create`

**Description:** Provisions a business after platform review of an existing
request. Creates the business inactive, creates its initial MAIN branch and an inactive terminal with a random activation code, approves and links the request, records an audit event, and queues a single-use owner redemption email containing redemption and initial terminal activation details. The email is sent asynchronously;
the API does not wait for delivery. The ownerâ€™s email defaults to the request
contact and may be overridden. PAN is required. **Auth:** signed-in platform
user; only `x-client-type: web` is accepted. **Rate limit:** 20 requests per
hour. **Errors:** 400 for invalid headers/body; 401 when signed out; 403 for a
non-platform user; 404 if the request does not exist; 409 for an already
provisioned request, duplicate PAN, or idempotency-key payload mismatch; 429
when rate limited. **Idempotency:** required; reuse of a key with the same
payload replays the original response. **Audit:** required. **Success:** 201.

```json
{
  "phase": 1,
  "endpoint": "POST /api/v1/platform/businesses/create",
  "requestData": {
    "pathParams": {},
    "queryParams": {
      "requested_business_id": "4ab7a3c1-7451-459e-9e89-37a917628fee"
    },
    "headers": {
      "Authorization": "Bearer <platform-access-token>",
      "X-Client-Type": "web",
      "Idempotency-Key": "provision-business-req-1092",
      "Content-Type": "application/json"
    },
    "body": {
      "pan": "ABCDE1234F",
      "ownerEmail": "owner@example.com"
    }
  },
  "responseData": {
    "httpStatus": 201,
    "body": {
      "message": "Business Example Retail has been verified. Redeem code has been sent to owner.",
      "businessId": "8b6dd8d2-53d4-4f52-87a1-5e8187423d56",
      "ownerActivationInvitationStatus": "queued"
    }
  }
}
```

### `POST /api/v1/platform/users/invite`

**Description:** Creates a platform-user invitation and queues a magic-link
email. The invite is stored with a SHA-256 token hash and expires after seven
days. The link opens
`FRONTEND_BASE_URL/accept/invite/<token-hash>`. **Auth:** signed-in platform
user; `x-client-type` must be `web`, `desktop`, or `mobile`. **Errors:** 400
for invalid body or headers; 401 when signed out; 403 for a non-platform user;
409 if the email already belongs to a platform user, has an open invite, or the
idempotency key is in use with a different payload; 429 when rate limited.
**Rate limit:** 20 invitations per hour.
**Idempotency:** required via `x-idempotency-key`; reuse with the same payload
replays the original response. **Success:** 200.

```json
{
  "phase": 1,
  "endpoint": "POST /api/v1/platform/users/invite",
  "requestData": {
    "pathParams": {},
    "queryParams": null,
    "headers": {
      "Authorization": "Bearer <platform-access-token>",
      "Content-Type": "application/json",
      "x-client-type": "web",
      "x-idempotency-key": "platform-user-inv-123"
    },
    "body": {
      "name": "Jane Manager",
      "email": "jane@example.com"
    }
  },
  "responseData": {
    "httpStatus": 200,
    "body": {
      "message": "Invite sent to Jane Manager"
    }
  }
}
```

### `POST /api/v1/authentication/register-owner`

**Description:** Registers the invited business owner using the emailed,
single-use redemption code. Creates a new user or verifies the password for an
existing account, adds an owner membership with no role and no branch
assignment, then activates the business and the initial terminal using the business ID, branch ID, and terminal code included in the redemption email. It returns the initial terminal IDs for the existing terminal-based login flow.
**Auth:** public; only `x-client-type: web` is accepted. **Rate limit:** 10
requests per hour. **Errors:** 400 for invalid registration data or client
type; 401 for an invalid, expired, consumed, email-mismatched code or invalid
existing-account password; 409 if already activated or already a member; 429
when rate limited. **Idempotency:** no; the single-use code makes registration
one-time. **Success:** 201.

```json
{
  "phase": 1,
  "endpoint": "POST /api/v1/authentication/register-owner",
  "requestData": {
    "pathParams": {},
    "queryParams": null,
    "headers": {
      "X-Client-Type": "web",
      "Content-Type": "application/json"
    },
    "body": {
      "email": "owner@example.com",
      "name": "Example Owner",
      "password": "<redacted>",
      "redeemCode": "<code-from-email>",
      "businessId": "<business-id-from-email>",
      "branchId": "<branch-id-from-email>",
      "terminalCode": "<terminal-code-from-email>"
    }
  },
  "responseData": {
    "httpStatus": 201,
    "body": {
      "message": "Owner account registered and business activated.",
      "userId": "45fbee7a-f45f-4738-96bc-32f90a5e34b3",
      "businessId": "8b6dd8d2-53d4-4f52-87a1-5e8187423d56",
      "isOwner": true,
      "roleId": null,
      "branchId": null,
      "initialTerminalId": "6f806a43-405a-44e8-81be-27a68379c646",
      "initialBranchId": "01234567-89ab-4cde-8f01-23456789abcd"
    }
  }
}
```

### `POST /api/v1/platform/user/login`

**Description:** Authenticates a platform user from `platform_users` and issues
a platform access/refresh session. `x-client-type` takes precedence over the
optional body `client_type`. If both are omitted, web behavior is used.
**Auth:** public. **Rate limit:** 20 requests per minute. **Errors:** 400 for
invalid body/client type, 401 for invalid credentials, 429 when rate limited.
**Idempotency:** no; login creates a new session.

Web clients receive HTTP-only cookies and a body without tokens. Mobile and
desktop clients receive both tokens in JSON.

```json
{
  "phase": 1,
  "endpoint": "POST /api/v1/platform/user/login",
  "requestData": {
    "pathParams": {},
    "queryParams": null,
    "headers": {
      "Content-Type": "application/json",
      "x-client-type": "mobile"
    },
    "body": {
      "email": "platformmanager@example.com",
      "password": "<redacted>"
    }
  },
  "responseData": {
    "httpStatus": 200,
    "body": {
      "accessToken": "<redacted>",
      "refreshToken": "<redacted>",
      "tokenType": "Bearer",
      "expiresIn": 900,
      "user": {
        "id": "45fbee7a-f45f-4738-96bc-32f90a5e34b3",
        "displayName": "Test Platform Manager"
      },
      "isPlatform": true,
      "isBootstrap": true
    }
  }
}
```

### `POST /api/v1/platform/user/refresh`

**Description:** Rotates a platform user's refresh token and issues a new
platform access token. `x-client-type` is required. Mobile/desktop clients send
`refresh-token`; web clients can send it in the header or use the
`refresh_token` cookie. **Auth:** public; a valid refresh token is required.
**Rate limit:** 60 requests per minute. **Errors:** 400 for invalid/missing
client type, 401 for a missing/invalid refresh token or inactive user, 429 when
rate limited. **Idempotency:** no; tokens rotate.

For web, new HTTP-only cookies are set and the response body omits token fields.
Mobile/desktop receive tokens in the response body.

```json
{
  "phase": 1,
  "endpoint": "POST /api/v1/platform/user/refresh",
  "requestData": {
    "pathParams": {},
    "queryParams": null,
    "headers": {
      "x-client-type": "mobile",
      "refresh-token": "<redacted>"
    },
    "body": null
  },
  "responseData": {
    "httpStatus": 200,
    "body": {
      "accessToken": "<redacted>",
      "refreshToken": "<redacted>",
      "tokenType": "Bearer",
      "expiresIn": 900,
      "user": {
        "id": "45fbee7a-f45f-4738-96bc-32f90a5e34b3",
        "displayName": "Test Platform Manager"
      },
      "isPlatform": true,
      "isBootstrap": true
    }
  }
}
```

## Notes for API consumers

- `Authorization: Bearer <access-token>` is used for private routes. For web
  requests, the JWT guard can also read the `access_token` cookie when
  `x-client-type: web` is supplied.
- User login reads `client_type` from the JSON body. Platform login prefers the
  `x-client-type` header and falls back to the optional body field.
- Business routes with `:businessId` require permissions (`@RequiredPermission`),
  decided in the database by `app.has_permission` (owner, branch scope,
  allow/deny overrides, role grants). Denials are one generic 403; a malformed
  `:businessId`/`:branchId` is 400. See `src/authorization/README.md`.
- Platform routes require platform permissions derived from the staff member's
  platform role (`admin`, `manager`, `support`; bootstrap acts as admin).
- `@RateLimit` limits are enforced by the global rate-limit guard. Routes with
  no `@RateLimit` decorator have no route-specific limit.
## GET /api/v1/businesses/{businessId}

**Description:** Returns the business profile and current activation state.
**Auth:** `business:read` in that business (the owner, or a member whose role or
overrides grant it). Platform tokens are denied.
**Headers:** `Authorization: Bearer <owner-access-token>` and optional
`x-client-type: web|desktop|mobile` (used by client-specific authentication
behavior; not a business selector). **Errors:** 400 for an invalid UUID, 401 for
missing/invalid authentication, 403 without `business:read` in that
business, and 404 when the business does not exist. PAN and registration
document references are not returned.

```json
{
  "phase": 1,
  "endpoint": "GET /businesses/{businessId}",
  "requestData": {
    "pathParams": { "businessId": "00000000-0000-4000-8000-000000000001" },
    "queryParams": null,
    "headers": {
      "Authorization": "Bearer <owner-access-token>",
      "x-client-type": "desktop"
    },
    "body": null
  },
  "responseData": {
    "httpStatus": 200,
    "body": {
      "id": "00000000-0000-4000-8000-000000000001",
      "legalName": "Example Trading Pvt Ltd",
      "displayName": "Example Trading",
      "address": "Main Street, Kathmandu",
      "addressDetails": {
        "country": "NP",
        "city": "Kathmandu",
        "postalCode": "44600",
        "addressLine1": "Main Street",
        "addressLine2": null
      },
      "primaryContactNumber": "+977-1-5550100",
      "primaryContactEmail": "owner@example.com",
      "isActive": true,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

## PATCH /api/v1/businesses/{businessId}

**Description:** Updates approved business profile fields and optionally replaces
business documents. **Auth:** `business:update` in the path business (owner and
admins by default). **Headers:**
`Authorization: Bearer <owner-access-token>`, `Idempotency-Key`, and
`x-client-type: web|desktop|mobile`. Use multipart form data; the client must set
the multipart boundary. **Permitted fields:** `reason` (required), `displayName`,
`country`, `city`, `postalCode`, `addressLine1`, `addressLine2`,
`primaryContactNumber`, and `primaryContactEmail`. Optional files:
`panCardFront`, `panCardBack`, `businessRegistrationCertificate` (one per field,
up to 10 MB each). Profile address fields update `addressDetails` and keep the
legacy `address` column synchronized. PAN, legal name, active status, identifiers,
and system timestamps are prohibited. **Idempotency:** the same owner, business,
key, and request payload replays the original response for seven days; reusing a
key with a different payload or an in-progress request returns 409. The key hash
includes uploaded file contents. **Audit:** profile changes and their audit event
are committed in the same database transaction; the required reason and before /
after profile values are recorded. Document audit metadata records changed file
field names, not document URLs. **Errors:** 403 for non-owners or business mismatch;
400 for an invalid business UUID or missing/invalid required headers; 404 for a
missing business; 409 for idempotency conflicts; 413 for a file larger than
10 MB; 422 for invalid or prohibited fields, missing reason, incomplete address
or documents, or an empty update; 503 if the idempotency service is unavailable.

```json
{
  "phase": 1,
  "endpoint": "PATCH /businesses/{businessId}",
  "requestData": {
    "pathParams": { "businessId": "00000000-0000-4000-8000-000000000001" },
    "queryParams": null,
    "headers": {
      "Authorization": "Bearer <owner-access-token>",
      "Content-Type": "multipart/form-data; boundary=<generated-by-client>",
      "Idempotency-Key": "idem_sample_001",
      "x-client-type": "desktop"
    },
    "body": {
      "reason": "Approved operation",
      "displayName": "Example Trading",
      "primaryContactEmail": "owner@example.com",
      "panCardFront": "<file part; optional>",
      "panCardBack": "<file part; optional>",
      "businessRegistrationCertificate": "<file part; optional>"
    }
  },
  "responseData": {
    "httpStatus": 200,
    "body": {
      "businessId": "00000000-0000-4000-8000-000000000001",
      "updatedAt": "2026-01-01T00:00:00.000Z",
      "changedFields": {
        "displayName": "Example Trading",
        "primaryContactEmail": "owner@example.com",
        "documents": ["panCard.frontImage"]
      }
    }
  }
}
```


## GET /api/v1/businesses/{businessId}/branches

**Description:** Lists business branches with their current operational status.
**Auth:** `branch:read` in the business (the owner, or a member whose role or
overrides grant it). A branch-scoped membership sees only its assigned branch; a membership with a null
branch assignment and the owner see all branches in the business. Platform users
are denied. **Headers:** `Authorization: Bearer <access-token>` and optional
`x-client-type: web|desktop|mobile` (required when using the web access-token
cookie). **Query:** optional timezone-aware ISO `from` and `to` filter `createdAt`
inclusively; `from` must not be after `to`. `limit` defaults to 50 and must be
1–100. `cursor` is an opaque cursor returned by the previous page and is bound to
the same business, date range, and membership scope. **Ordering:** newest branch
first by `createdAt`, then `id`; pagination uses a stable keyset cursor.
**Response:** `items` contains `id`, `name`, `code`, `address`, `contactNumber`,
`status` (`active` or `inactive`), `createdAt`, and `updatedAt`. `nextCursor` is
null on the last page. Status is current; the database does not retain status
history. **Audit:** none for this read. **Errors:** 400 for an invalid business
UUID, date range, limit, or cursor; 401 for authentication failure; 403 for
wrong-business, platform, inactive membership, missing role assignment, or
unconfigured `branches.read`; 503 for an unexpected database failure.

```json
{
  "phase": 1,
  "endpoint": "GET /businesses/{businessId}/branches",
  "requestData": {
    "pathParams": { "businessId": "00000000-0000-4000-8000-000000000001" },
    "queryParams": {
      "from": "2026-10-01T00:00:00+05:45",
      "to": "2026-10-29T23:59:59+05:45",
      "limit": 50,
      "cursor": null
    },
    "headers": {
      "Authorization": "Bearer <access-token>",
      "x-client-type": "desktop"
    },
    "body": null
  },
  "responseData": {
    "httpStatus": 200,
    "body": {
      "items": [
        {
          "id": "00000000-0000-4000-8000-000000000002",
          "name": "Main Branch",
          "code": "MAIN",
          "address": "Main Street, Kathmandu",
          "contactNumber": "+977-1-5550100",
          "status": "active",
          "createdAt": "2026-10-15T12:00:00.000Z",
          "updatedAt": "2026-10-16T12:00:00.000Z"
        }
      ],
      "nextCursor": null
    }
  }
}
```

## GET /api/v1/businesses/{businessId}/branches/{branchId}

**Description:** Reads a branch profile and current operational summary.
**Auth:** `branch:read` at that branch. A branch-scoped member (or one whose role
is limited to a branch) gets 403 for other branches; a business-wide member and
the owner can read any branch in the business. Platform users are denied.
**Headers:** `Authorization: Bearer <access-token>` and optional
`x-client-type: web|desktop|mobile` (required when using the web access-token
cookie). **Response:** `branch` contains `id`, `businessId`, `name`, `code`,
`address`, `contactNumber`, current `status`, `createdAt`, and `updatedAt`.
`summary.terminals` contains counts by `active`, `inactive`, and `maintenance`
plus `total`. `summary.members` contains active and inactive membership counts
directly assigned to this branch plus `total`; business-wide memberships are
excluded. Counts reflect current state. **Audit:** none for this read.
**Errors:** 401 for authentication failure; 403 for wrong-business, platform,
inactive membership, or missing role permission; 404 when the branch does not
exist in the requested business or is outside the member's branch scope; 503
for an unexpected database failure.

```json
{
  "phase": 1,
  "endpoint": "GET /businesses/{businessId}/branches/{branchId}",
  "requestData": {
    "pathParams": {
      "businessId": "00000000-0000-4000-8000-000000000001",
      "branchId": "00000000-0000-4000-8000-000000000002"
    },
    "queryParams": null,
    "headers": {
      "Authorization": "Bearer <access-token>",
      "x-client-type": "desktop"
    },
    "body": null
  },
  "responseData": {
    "httpStatus": 200,
    "body": {
      "branch": {
        "id": "00000000-0000-4000-8000-000000000002",
        "businessId": "00000000-0000-4000-8000-000000000001",
        "name": "Main Branch",
        "code": "MAIN",
        "address": "Main Street, Kathmandu",
        "contactNumber": "+977-1-5550100",
        "status": "active",
        "createdAt": "2026-10-15T12:00:00.000Z",
        "updatedAt": "2026-10-16T12:00:00.000Z"
      },
      "summary": {
        "terminals": {
          "active": 2,
          "inactive": 0,
          "maintenance": 1,
          "total": 3
        },
        "members": { "active": 4, "inactive": 1, "total": 5 }
      }
    }
  }
}
```

### `POST /api/v1/platform/businesses/{businessId}/branches`

**Description:** Creates a branch and its terminals for an existing business.
The platform user may provide `terminals: [{ "name": "..." }]` to create one
or more named terminals. When omitted, one inactive `Initial Terminal` is created. Each terminal receives a cryptographically random `POS-` activation code, unique per branch. The active business owner receives a styled email with branch details and each terminal name, ID, and activation code. **Auth:** signed-in platform user only;
`x-client-type` must be `web`. **Headers:** `Authorization`, `Content-Type:
application/json`, `Idempotency-Key`, and `x-client-type`. **Idempotency:**
required and actor-scoped; repeating the same key and request replays the saved
response. Reusing the key with a different payload or an in-progress operation
returns 409. **Audit:** required; branch, terminals, and audit event are created
atomically. **Errors:** 400 for invalid fields/headers, 401 when signed out,
403 for a non-platform user, 404 if the business does not exist, 409 for a
branch code already used by that business or an idempotency conflict, 503 for
unexpected database or Redis failures. **Success:** 201 with branch ID/name and
created inactive terminal IDs, names, and generated activation codes.

```json
{
  "phase": 1,
  "endpoint": "POST /platform/businesses/{businessId}/branches",
  "requestData": {
    "pathParams": {
      "businessId": "00000000-0000-4000-8000-000000000001"
    },
    "queryParams": null,
    "headers": {
      "Authorization": "Bearer <platform-access-token>",
      "Content-Type": "application/json",
      "Idempotency-Key": "platform-branch-create-001",
      "x-client-type": "web"
    },
    "body": {
      "name": "Downtown Branch",
      "code": "DOWNTOWN",
      "address": "Main Street, Kathmandu",
      "contactNumber": "+977-1-5550100",
      "terminals": [
        { "name": "Front Counter" },
        { "name": "Cafe Counter" }
      ]
    }
  },
  "responseData": {
    "httpStatus": 201,
    "body": {
      "branch": { "id": "00000000-0000-4000-8000-000000000002", "name": "Downtown Branch" },
      "terminals": [
        { "id": "00000000-0000-4000-8000-000000000003", "name": "Front Counter", "terminalCode": "POS-A1B2C3D4E5F60718" },
        { "id": "00000000-0000-4000-8000-000000000004", "name": "Cafe Counter", "terminalCode": "POS-1234567890ABCDEF" }
      ]
    }
  }
}
```

### `POST /api/v1/businesses/{businessId}/branches/{branchId}/terminals/activate`

**Description:** Activates an inactive terminal using its emailed activation code. Requires `terminal:activate` at that branch (owners, admins, and branch managers of that branch by default). Business ID and branch ID scope the code to one terminal; repeating activation for an active terminal returns its current details. **Auth:** `terminal:activate` at the branch. **Errors:** 403 without that permission (including other branches or businesses); 404 if the business, branch, terminal, or code combination does not match; 409 if the terminal cannot be activated. Activation is audited and the activation code is excluded from audit metadata.

```json
{
  "phase": 1,
  "endpoint": "POST /api/v1/businesses/{businessId}/branches/{branchId}/terminals/activate",
  "requestData": {
    "pathParams": { "businessId": "<business-id>", "branchId": "<branch-id>" },
    "queryParams": null,
    "headers": {
      "Authorization": "Bearer <owner-access-token>",
      "Content-Type": "application/json",
      "x-client-type": "web"
    },
    "body": { "terminalCode": "POS-<activation-code-from-email>" }
  },
  "responseData": {
    "httpStatus": 200,
    "body": { "id": "<terminal-id>", "name": "Counter One", "terminalCode": "POS-<activation-code>", "status": "active" }
  }
}
```
