<!-- story: e03s04 -->
# e03s04 — Rotate permission audit logs

## 1. Identity
- **Story:** e03s04
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 2
- **Risk:** P1

## 2. User need
Permission audit history should remain local, discoverable, and bounded instead of growing indefinitely in an unrelated configuration directory.

## 3. Goal
Store permission audit logs under `~/.pi/tool-permissions/` as UTC-dated files, keep `audit.log` pointing to the current file, migrate the legacy log, and retain only seven days.

## 4. Non-goals
- Changing audit event fields or permission decisions.
- Project-local audit logs.
- Remote log shipping or encryption.

## 5. Requirements
### ADDED: Dated audit files
Write entries to `~/.pi/tool-permissions/audit-YYYY-MM-DD.log`, using UTC date boundaries.

### ADDED: Current-log symlink
Maintain `~/.pi/tool-permissions/audit.log` as a symlink to the current UTC-dated file.

### ADDED: Legacy migration
On first use, migrate `~/.config/pi/audit.log` into the new audit location without losing entries. Migration must be safe to retry.

### ADDED: Retention
Delete dated audit files older than seven calendar days. Never delete the current file.

### ADDED: Failure handling
If migration, rotation, symlink maintenance, or cleanup fails, surface a warning and continue logging to the best available target. Audit failures must never block a tool call.

## 17. Acceptance criteria
### Scenario: Write to the current dated log
**Given** the tool-permissions audit logger is used
**When** an audit event is recorded
**Then** it is appended to the current UTC-dated file under `~/.pi/tool-permissions/`
**And** `audit.log` points to that file.

### Scenario: Migrate the legacy log
**Given** `~/.config/pi/audit.log` exists and the new audit directory has not migrated it
**When** the audit logger initializes
**Then** all legacy entries are available in the new dated log
**And** retrying initialization does not duplicate migrated entries.

### Scenario: Retain one week
**Given** dated files older than seven calendar days exist
**When** the logger rotates
**Then** those files are deleted
**And** files from the last seven days and the current file remain.

### Scenario: Rotation failure
**Given** the new location or symlink cannot be updated
**When** an audit event is recorded
**Then** a warning is surfaced
**And** logging continues to the best available target
**And** the tool call is not blocked by the audit failure.

## 18. Automated verification
- `node --test extensions/tool-permissions/audit.test.ts`
- `npm run check`

## 19. Implementation tasks
1. Extract an injectable audit-log manager for UTC paths, migration, symlink maintenance, retention, and fallback behavior → verify: `node --test extensions/tool-permissions/audit.test.ts`
2. Integrate the manager into permission auditing and update the documented path → verify: `node --test extensions/tool-permissions/documentation.test.ts`
3. Confirm package-wide behavior and types → verify: `npm run check`

## 20. Definition of done
The new dated audit path, symlink, migration, seven-day retention, warning behavior, fallback logging, tests, and documentation are complete.
