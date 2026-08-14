<!-- story: e08s01 -->
# e08s01 — Restore portable Windows preflight contracts

## 1. Identity
- **Story:** e08s01
- **Type:** fix
- **Maturity:** 3 — Countable
- **BCPs:** 6
- **Risk:** P1
- **Delta:** MODIFIED
- **Source bug:** BUG-2026-08-13T231226

## 2. User need

Developers need `npm run check` to exercise the same extension contracts from Bash on Windows with Git Bash as on a POSIX host, without requiring administrator privileges or Windows command-wrapper fixtures.

## 3. Goal

Replace operating-system-specific test assumptions with host-native Node.js fixtures, and make the current permission audit-log alias resilient when symbolic links cannot be created.

## 4. Non-goals

- Changing the production command-discovery algorithm or supporting extensionless Bash scripts through native Windows spawning
- Changing subagent canonicalization, containment rules, permission precedence, or TOML policy syntax
- Changing audit record shape, UTC date selection, migration behavior, retention duration, or authorization decisions
- Invoking `bash -c`, generating `.cmd` wrappers, requiring administrator privileges, or adding dependencies
- Creating a reusable cross-platform filesystem framework

## 5. Requirements

### MODIFIED: Bigpowers preflight test scope
**Before:** `npm run check` executes both extension tests and optional example tests, so a platform-dependent Bevy provider fixture can fail the required preflight.
**After:** `npm run check` executes typecheck plus extension tests only. The existing `npm test` command continues to include extension and example tests for explicit full-suite verification. The Bevy provider example test is unchanged.

### MODIFIED: Exact permission-path fixture contract
**Before:** The subagent permission test manually escapes a temporary path with an expression that fails to preserve Windows separators through TOML and regular-expression parsing.
**After:** The fixture serializes a single exact-path rule correctly through both representations and verifies that only the intended path is authorized.

### MODIFIED: Canonical directory-escape fixture contract
**Before:** The canonical containment test unconditionally creates a directory symbolic link and therefore depends on the caller having Windows symlink privileges.
**After:** The test creates an external directory alias through Node filesystem capabilities, preferring a symbolic link and falling back to a directory junction only when the first capability is unavailable. The observable assertion remains canonical escape rejection.

### MODIFIED: Current audit-log alias and retention contract
**Before:** `audit.log` is maintained only as a symbolic link. An alias failure skips dated-log retention because both operations share one error boundary.
**After:** The dated UTC file remains authoritative. `audit.log` is maintained as a relative symbolic link when possible and otherwise as a same-directory hard link. Alias maintenance and dated-log retention run independently and emit independent non-blocking warnings.

## 6. Zoom-out analysis

### Executable discovery module

- **Purpose:** Detect whether the optional Bevy MCP provider command is available in the host PATH before activation
- **Callers:** The Bevy debugger MCP extension and its public unit tests
- **Preserved contracts:** Absence returns `false`; discovery honors the host executable naming rules; the optional integration test remains conditionally skipped

### Subagent working-directory module

- **Purpose:** Resolve a child working directory and reject any canonical path outside the canonical parent
- **Callers:** The subagent tool execution path and working-directory contract tests
- **Preserved contracts:** Missing and non-directory paths fail; nested directories resolve; canonical escapes fail closed

### Permission audit module

- **Purpose:** Append authorization events to a UTC-dated user-local log, expose the current log through `audit.log`, migrate legacy data, and bound retention
- **Callers:** The tool-permissions extension initializes one logger; audit unit tests exercise its public writer
- **Preserved contracts:** Audit writing never blocks tool execution; the current dated file receives successful entries; migration is retry-safe; only dated logs older than seven calendar days are deleted

## 7. Solution architecture

Keep the change local to the affected fixtures and audit module.

- Package scripts define a preflight test scope containing only extension tests; the full test scope remains available separately
- The permission test owns a minimal exact-regex/TOML serialization helper or equivalent inline conversion that encodes each representation exactly once
- The working-directory test owns a narrow test helper that tries a directory symlink first and tries Node's `junction` link type only after symlink creation fails
- The audit module owns a narrow alias-maintenance seam so tests can deterministically make alias creation unavailable without depending on machine privileges

**Reason for Depth:** The audit alias seam isolates only the environment-dependent alias operation, allowing observable fallback and independent retention behavior to be tested without turning the full filesystem API into an abstraction.

No new external package is proposed: **[OK] no dependency added**.

## 8. Data and state changes

No policy, API, or persisted record schema changes occur.

The only filesystem-state variation is the existing `audit.log` alias: it may be a symbolic link or a hard link, but opening it exposes the same current dated file content. Dated files remain the retention source of truth.

## 9. Security and resilience

- Canonical containment remains unchanged and continues to reject directory aliases that resolve outside the parent
- Permission-rule tests add a near-miss denial assertion to prevent overly broad exact-path escaping
- Alias maintenance remains best effort: failures produce warnings but cannot alter an allow, deny, ask, or successful dated write
- Retention has its own error boundary so an alias failure cannot leave expired audit logs unprocessed
- The fallback hard link is constrained to the current target in the same audit directory; it does not introduce arbitrary target linking

## 10. Failure handling

- If a generated test alias cannot be created as either symlink or junction, fail that test with a capability diagnostic rather than silently weakening containment coverage
- If `audit.log` cannot be maintained as either alias type, warn and retain the successful dated write
- If retention fails, warn independently and retain the successful dated write and alias result
- If the dated write fails, preserve existing fallback logging to the legacy location

## 11. Compatibility

- Windows Git Bash, PowerShell, and POSIX shells invoke the same Node/npm commands
- Runtime behavior is selected by Node filesystem capability, never by detecting Git Bash
- POSIX keeps the preferred relative symbolic-link behavior
- Windows without symlink privilege uses the hard-link alias fallback; no elevated prompt is required

## 12. Observability

Use the existing warning callback/stderr path for audit maintenance warnings. Warnings identify the failed operation without exposing audit contents or changing tool results.

## 13. Test strategy

### Preflight and fixture portability corrections

1. Run `npm run check` without collecting optional example tests
2. Resolve a TOML exact-path permission rule for the target and reject a neighboring path
3. Use an alias that canonically escapes the parent and assert `resolveSubagentCwd` rejects it

### Audit resilience TDD cycles

1. Add a behavioral test that simulates unavailable symbolic-link creation and proves `audit.log` opens the current entry through the hard-link fallback
2. Add a behavioral test that makes alias maintenance fail while an expired dated log exists and proves cleanup still runs with a warning
3. Implement the smallest alias seam and independent maintenance boundaries to satisfy those tests

Tests assert public behavior or filesystem-observable state. They do not assert the internal fallback branch, a specific link type, or shell behavior.

## 14. Implementation steps

1. Add a preflight-only test script containing extension tests and keep the existing full test script unchanged → verify: `npm run check`
2. Correct exact-path policy serialization and add a target-versus-neighbor authorization contract without changing permission resolution → verify: `node --test extensions/subagent/agent-session.test.ts`
3. Add a capability-based directory-alias fixture with symlink-first and junction fallback, then preserve the canonical escape rejection assertion → verify: `node --test extensions/subagent/working-directory.test.ts`
4. RED: add a deterministic public audit behavior test for a current alias when symbolic-link creation is unavailable → verify: `node --test extensions/tool-permissions/audit.test.ts`
5. GREEN: implement local alias maintenance that prefers a relative symlink, falls back to a same-directory hard link, and retains dated-write warning behavior → verify: `node --test extensions/tool-permissions/audit.test.ts`
6. RED: add a deterministic audit behavior test proving expired dated logs are removed despite alias-maintenance failure → verify: `node --test extensions/tool-permissions/audit.test.ts`
7. GREEN: separate alias maintenance from retention cleanup, preserve independent warnings, and run the complete Windows-safe regression stack → verify: `npm run check`

## 15. Verification script

1. From the repository root in Bash, run `npm run check`
2. Run `node --test extensions/subagent/agent-session.test.ts`
3. Run `node --test extensions/subagent/working-directory.test.ts`
4. Run `node --test extensions/tool-permissions/audit.test.ts`
5. Run `npm run check`
6. On a Windows host through Git Bash, confirm all commands exit successfully without a `.cmd` fixture, `/tmp` assumption, or elevated symlink permission
7. On a POSIX host, confirm the same commands preserve symbolic-link compatibility and pass

## 16. Rollout and rollback

This is a local extension/test repair with no deployment or configuration migration.

If the audit alias fallback has an unforeseen filesystem incompatibility, revert the story as a unit; dated audit writes continue to be the authoritative data path and the pre-existing warning behavior prevents authorization impact.

## 17. Acceptance criteria

### Scenario: Preflight excludes optional examples
**Given** the repository has extension tests and optional example tests
**When** `npm run check` executes
**Then** typechecking and extension tests run
**And** optional example tests are not collected
**And** the existing `npm test` command remains available for the full suite.

### Scenario: Exact permission path
**Given** a temporary target path and a TOML exact-path permission rule
**When** the subagent authorization probe evaluates the target
**Then** the request is allowed
**And** a different neighboring path is not allowed by that exact rule.

### Scenario: Canonical directory escape
**Given** a child alias whose canonical target is outside the parent working directory
**When** subagent cwd resolution evaluates the child
**Then** resolution rejects it as outside the parent
**And** the test does not require elevated Windows privileges.

### Scenario: Current audit alias without symlink support
**Given** symbolic-link alias creation is unavailable
**When** an audit event is written successfully
**Then** the current UTC-dated file contains the event
**And** opening `audit.log` exposes the same event
**And** the authorization path is unaffected.

### Scenario: Retention despite alias failure
**Given** alias maintenance fails and an expired dated audit log exists
**When** an audit event is written successfully
**Then** the expired log is removed
**And** an alias-maintenance warning is emitted
**And** the current dated file retains the event.

### Scenario: Bash portability
**Given** Node and npm are invoked from Git Bash on Windows
**When** the story verification commands run from the repository root
**Then** all commands exit successfully without invoking a platform-specific shell command.

## 18. Automated verification

- `npm run check`
- `node --test extensions/subagent/agent-session.test.ts`
- `node --test extensions/subagent/working-directory.test.ts`
- `node --test extensions/tool-permissions/audit.test.ts`
- `npm run check`
- `bash scripts/lib/plan-consistency-check.sh .specs/epics/e08-windows-preflight-portability`

## 19. Definition of done

All task-ledger entries are `passing`; the Windows baseline is green from Git Bash; POSIX regression verification is green; audit alias and retention failures are independently tested; the source bug is marked resolved with verification evidence; and no implementation introduces `.cmd` fixtures, elevated-privilege requirements, shell detection, or dependencies.

## 20. Traceability

- Source: `BUG-2026-08-13T231226-windows-preflight-portability.md`
- Design: `BUG-2026-08-13T231226-windows-preflight-portability-design.md`
- Affected tests: Bevy MCP discovery, subagent authorization, subagent working-directory containment, permission audit logging
- Affected runtime module: tool-permissions audit logger
- Primary security contract: canonical child containment and non-blocking authorization audit behavior
