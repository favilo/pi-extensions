# Impact Analysis — e03s04 Rotating Audit Logs

## Target
`extensions/tool-permissions/index.ts` audit persistence (`AUDIT_LOG_PATH` and `audit()`), plus README audit-path documentation.

## Dependents (1)
- `extensions/tool-permissions/index.ts`: all permission decision handlers call `audit()`.
- `README.md`: documents the user-facing audit path.

## Affected Stories
- e03s04 — Rotate permission audit logs (new requirement).
- e03s01/e03s02 — audit event consumers remain behaviorally affected because their entries use the new storage manager, but event fields and decisions must not change.

## Test Coverage
- `extensions/tool-permissions/config.test.ts`: unrelated persistence coverage.
- `extensions/tool-permissions/index.test.ts`: scoped decision routing; no direct audit storage coverage.
- Gap: dated path calculation, symlink maintenance, legacy migration, retention, and fallback behavior require new focused tests.

## Risk: Medium
One shared audit call site fans out to every permission handler. The change is isolated to local filesystem persistence, but migration, symlink replacement, date boundaries, retention, and failure fallback need deterministic tests.

## Recommended action
Add an injectable audit-log manager and focused tests before integrating it into the permission extension. Preserve non-blocking audit behavior and existing event shape.

## WSJF
Provisional WSJF: `(business value 3 + time criticality 1 + risk reduction 3) / job size 2 = 3.5` for this story; epic ordering remains below e04 and e05 because the epic-level score is unchanged by release sequencing.
