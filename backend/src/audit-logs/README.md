# audit-logs

Append-only security and access history.

| Table                 | Written by                                                  | Actor                                                                                                  |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `access_logs`         | `AuditLogsService.insertUserEvent` / `logUserEvent`         | business user (login, refresh, owner registration, terminal activation, business update, role changes) |
| `platform_audit_logs` | `AuditLogsService.insertPlatformEvent` / `logPlatformEvent` | platform user (login, refresh, provisioning, branch creation)                                          |

## Rules

- `insert*` takes the caller's transaction, so the audit row commits or rolls back with the change it records.
- `log*` opens its own transaction and swallows errors (logged as a warning). Use it only on failure paths where the main transaction already rolled back.
- Never put passwords, tokens or raw invitation codes in `metadata`.
- Read operations are not audited.

## Layout

`audit-logs.service.ts` (rules) → `audit-logs.repository.ts` (all SQL) → `DatabaseService`.
Other modules import `AuditLogsModule` / `AuditLogsService` from the `../audit-logs` barrel.

## Tests

`test/audit-logs.service.spec.ts`.
