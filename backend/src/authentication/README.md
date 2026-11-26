# authentication

Sign-in for business users (owners and staff, `users`) and Fortis staff (`platform_users`): passwords, access tokens, refresh sessions, the refresh cookie and owner registration.

## Endpoints (prefix `/api/v1`)

| Method | Path                                                                    | Auth                           | Notes                                                                                                                                                     |
| ------ | ----------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/authentication/login`                                                 | public, strict throttle        | Email + password. `x-terminal-id` is required for every client except `web`; the terminal must be active and belong to the member's business and branch.  |
| POST   | `/authentication/refresh`                                               | public, strict throttle        | Rotates the refresh token (body `refreshToken`, or the cookie for browsers).                                                                              |
| POST   | `/authentication/logout`                                                | public                         | Always **204**. Revokes the session of the given refresh token and clears the cookie.                                                                     |
| POST   | `/authentication/logout-all`                                            | business user                  | Revokes every session of the caller: `{ revoked }`.                                                                                                       |
| GET    | `/authentication/me`                                                    | business user                  | Profile, active context, effective permissions. Re-checks that the account and membership are still active.                                               |
| POST   | `/authentication/register-owner`                                        | public, web only               | First owner of a provisioned business (redeem code). Issues no tokens.                                                                                    |
| POST   | `/authentication/change-password`                                       | business user, strict throttle | Requires `currentPassword` (400 missing, 403 wrong); the new password must differ (400). Signs out every device and returns a new session (login-shaped). |
| POST   | `/authentication/forgot-password`                                       | public, strict throttle        | Always **202** with the same body. Emails a 30-minute single-use link to active accounts only.                                                            |
| POST   | `/authentication/reset-password`                                        | public, strict throttle        | `{ token, newPassword }`. 204, or one generic 400. Signs out every device.                                                                                |
| POST   | `/platform/user/login`                                                  | public, strict throttle        | Fortis staff.                                                                                                                                             |
| POST   | `/platform/user/refresh`                                                | public, strict throttle        | Body `refreshToken` (the `refresh-token` header is a deprecated fallback).                                                                                |
| POST   | `/platform/user/logout`                                                 | public                         | Always 204.                                                                                                                                               |
| POST   | `/platform/user/logout-all`                                             | platform user                  |                                                                                                                                                           |
| POST   | `/platform/user/change-password`, `/forgot-password`, `/reset-password` | as above                       | Same rules for Fortis staff; links go to `/platform/reset-password`.                                                                                      |

## Token contract (frontend)

- **Access token:** HS256 JWT in the JSON body as `accessToken`, sent back as `Authorization: Bearer`. Lifetime `JWT_ACCESS_TTL` (15m). Claims include `iss` and `aud`. Business-user tokens (`JWT_AUDIENCE`) and platform tokens (`JWT_PLATFORM_AUDIENCE`) are not interchangeable.
- **Refresh token:** 32 random bytes (base64url). Delivery depends on `X-Client-Type`:
  - `web`, `web_terminal`: only as the httpOnly cookie `refresh_token`, `SameSite=Lax`, `Secure` in production, scoped to `/api/v1/authentication` (or `/api/v1/platform/user`). Never in the body.
  - `desktop`, `android_pos`, `mobile`: in the JSON body as `refreshToken`.
- `remember: true` gives a refresh lifetime of `REFRESH_TOKEN_TTL_DAYS` and a persistent cookie. Otherwise it is `REFRESH_TOKEN_SESSION_TTL_HOURS` and a browser-session cookie. The access token lifetime is the same either way.
- Clients must refresh **single-flight**: refresh only after a 401, once, then retry the request. Two parallel refreshes with the same token look like token theft and sign the user out everywhere.
- A 401 from refresh clears the cookie; the client should send the user to the login page.

## Sessions and rotation

`public.sessions` stores only the SHA-256 of each refresh token. All writes go through SECURITY DEFINER functions (`script/sql/02-security-functions.sql`):

- `auth_rotate_session` is atomic. The old session gets `revoked_at` and `rotated_at`, and a new one is created.
- **Reuse vs invalid:** only a token that was already _rotated_ counts as reuse (a stale copy was replayed). Reuse revokes every session of that account and returns 401. A token revoked by logout, logout-all or a disabled account is plain invalid: 401, and nothing else is touched. Unknown and expired tokens are also plain 401.
- Revoked sessions are kept until the purge job removes them, because reuse detection needs them.

## Passwords

- New passwords: 10–128 characters.
- Reset tokens are 32 random bytes. Only their SHA-256 is stored, in `password_reset_tokens`, which the runtime role cannot read: it has RLS with no policies and is reached only through `app.auth_create_reset_token` and `app.auth_consume_reset_token`.
- Requesting a new link invalidates older ones. Consuming a link sets the hash and revokes every session in one SQL statement.
- `password_hash` columns are not readable by `fortis_app` at all (column privileges). Hashes are reached only through `app.auth_find_*_by_email` and `app.auth_current_password_hash()`.
- A reset email that cannot be queued is logged, not reported: the response must not depend on whether the account exists.

## Rules and gotchas

- **The access token is stateless.** A disabled account keeps its token until it expires (≤ 15 min). `refresh` and `/me` re-check the account; other routes rely on the short lifetime.
- **Sign-in timing:** an unknown email runs a dummy argon2 verification, so it takes as long as a wrong password. Both return the same 401 message.
- **Passwords** are argon2id (m=19456 KiB, t=2, p=1). bcrypt hashes from before the migration still verify and are upgraded on the next successful sign-in.
- **Pre-auth lookups** (`app.auth_find_*`) are the only way the API reads accounts before a user context exists. Id-based lookups answer only for the caller's own id.
- Platform routes carry `@PlatformRoute()`; every other protected route accepts only business-user tokens.

## Layout

| Concern         | Files                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| HTTP            | `authentication.controller.ts`, `platform-authentication.controller.ts`, `utils/auth-response.util.ts` |
| Rules           | `authentication.service.ts`, `platform-authentication.service.ts`                                      |
| SQL             | `authentication.repository.ts`, `platform-authentication.repository.ts`, `sessions.repository.ts`      |
| Building blocks | `password.service.ts`, `token.service.ts`, `auth-cookie.service.ts`, `strategies/`                     |

## Config

`JWT_ACCESS_SECRET` (≥ 32 characters; `JWT_SECRET` is accepted as the old name), `PASSWORD_RESET_TTL_MINUTES`, `FRONTEND_BASE_URL` (reset links), `JWT_ACCESS_TTL`, `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_PLATFORM_AUDIENCE`, `REFRESH_TOKEN_TTL_DAYS`, `REFRESH_TOKEN_SESSION_TTL_HOURS`, `THROTTLE_*`, `AUTH_THROTTLE_LIMIT`.

## Tests

- Unit tests are in `test/`.
- Full flows against real Postgres and Redis are in `../../test/authentication/authentication-flows.db-spec.ts`: login on web and desktop, rotation, reuse, logout, logout-all, the disabled-account check, platform sessions and audience separation.
- The SQL functions are tested in `../../test/database/session-functions.db-spec.ts`.
