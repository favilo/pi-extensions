# High-level design: portable Windows preflight repair

## Purpose

Restore a green preflight on Windows, including Node.js launched from Git Bash, without making the repository depend on Windows command wrappers or shell-specific filesystem behavior.

This document defines behavioral boundaries for Terra to expand into Bigpowers execution documents. It does not prescribe commit sequencing or implementation details.

## Design constraints

- Project commands remain runnable from Bash
- Tests must not create `.cmd` wrappers or assume `/tmp`, POSIX executable bits, or elevated link privileges
- Runtime code must prefer Node.js platform abstractions over shell commands
- Compatibility behavior should be capability-based where practical, not selected because a particular shell is running
- Existing Linux behavior, authorization decisions, canonical path containment, audit contents, and seven-day retention remain unchanged
- Audit maintenance failures must never block or alter a tool authorization decision
- Test fixtures must exercise observable contracts rather than reproduce operating-system internals

## Defect groups

The five failing assertions represent four defect groups:

1. An executable-discovery test models only a POSIX executable
2. A permission-policy fixture incorrectly serializes an exact Windows path into a regular expression and TOML
3. A containment test requires directory-symbolic-link privileges that ordinary Windows processes may not have
4. Audit alias creation assumes symbolic-link support, and its failure prevents retention from running

The executable-discovery failure is intentionally excluded from required Bigpowers preflight because the optional provider example remains unchanged. The permission and containment failures are fixture portability defects. The audit behavior includes a production resilience defect.

## Solution outline

### 1. Keep optional provider examples outside required preflight

Define a dedicated preflight test script containing only `extensions/*/*.test.ts`. Keep the existing `npm test` script unchanged so optional examples, including the Bevy provider test, remain explicitly runnable. This changes required test scope rather than weakening or rewriting the provider contract.

The preflight boundary is independent of the shell that invokes npm and does not detect Git Bash or Windows. It is a project test-selection configuration, not a runtime behavior change.

### 2. Serialize exact permission paths without separator-specific logic

Build the anchored path expression in two independent steps:

1. Escape regular-expression metacharacters in the actual target path
2. Serialize the resulting expression as a TOML string with a standards-compliant string representation

Do not add a Windows-only replacement branch. Backslashes must survive both the regular-expression layer and the TOML string layer because each layer is encoded exactly once.

The durable assertion is that the public permission resolver allows the exact path and does not allow a neighboring path. The test should not assert the intermediate escaped string.

### 3. Create canonical directory aliases through a portability seam

Keep the production containment algorithm unchanged: canonicalize the parent and requested directory, then reject a canonical child outside the parent.

Move test-only directory-alias creation behind a small helper that uses Node filesystem APIs. It should prefer an ordinary directory symbolic link and fall back, only when that capability is unavailable, to Node’s non-elevated directory-junction support. The fallback is based on the failed capability, not on detecting Git Bash.

The test contract remains that a lexical child path whose canonical target is outside the parent is rejected. Link type is not part of the assertion.

### 4. Treat `audit.log` as a portable current-log alias

Retain the dated audit file as the source of truth. Maintain `audit.log` as a compatibility alias using this strategy:

1. Reuse a valid alias to the current dated file
2. Prefer a relative symbolic link when supported
3. Fall back to a same-directory hard link when symbolic links are unavailable
4. Warn if neither representation can be maintained, but preserve the successful dated write

Consumers must be able to open `audit.log` and observe the current dated log. They must not be required to distinguish a symbolic link from a hard link.

Alias maintenance and expired-log cleanup must execute in separate failure boundaries. Alias failure may emit a warning, but it must not skip retention. Retention failure may emit its own warning, but it must not invalidate the audit write.

No shell command, elevated privilege, or platform-specific command wrapper is part of this strategy.

## Behavioral contracts

- `npm run check` runs typecheck and extension tests without collecting optional examples
- `npm test` remains the explicit full extension-and-example suite
- An exact permission rule authorizes the intended canonical path on every host
- A sibling or prefix-similar path is not accidentally authorized
- A canonical directory escape is rejected without requiring elevated privileges
- Every successful audit write appends to the current UTC-dated file
- `audit.log` exposes the current log whenever either supported alias capability is available
- Expired dated logs are processed even when alias maintenance fails
- Alias and retention warnings never affect permission decisions or the successful dated write

## Verification strategy

### Fixture corrections

The permission and containment tests are portability corrections to existing test fixtures. The optional Bevy example is deliberately not modified; its provider discovery contract remains available through the full test command. Do not invent production behavior changes merely to manufacture a RED phase.

### Audit resilience TDD

Use behavioral tests for the production defect:

- Force symbolic-link alias creation to be unavailable and verify that `audit.log` still exposes the current entry through the fallback
- Force all alias maintenance to fail while an expired dated file exists and verify that retention still removes the expired file
- Verify warnings are emitted without losing the current dated entry

Filesystem failure simulation should use a narrow injectable filesystem/alias seam or deterministic filesystem state. Tests must not depend on the privileges of the machine running them.

### Commands

Run from the repository root in Bash:

```bash
npm run check
node --test extensions/subagent/agent-session.test.ts
node --test extensions/subagent/working-directory.test.ts
node --test extensions/tool-permissions/audit.test.ts
npm run check
```

## Risks and mitigations

- **Example coverage gap:** optional examples remain covered by `npm test`; only required preflight excludes them
- **Escaping regression:** assert authorization outcomes for both the target and a near miss rather than asserting helper output
- **Containment weakening:** do not change canonicalization or containment logic; change only alias fixture creation
- **Stale audit alias:** validate the alias by observable current content before reusing it
- **Retention coupling:** isolate alias and retention error handling and warnings
- **Over-abstraction:** keep portability seams local to the affected test or audit module

## Non-goals

- Making extensionless Bash scripts directly executable by native Windows process spawning
- Replacing Node process execution with `bash -c`
- Changing permission precedence or policy syntax
- Changing subagent working-directory boundaries
- Changing audit record fields, migration semantics, UTC rotation, or retention duration
- Introducing a general cross-platform filesystem framework

## Terra planning handoff

Terra should expand this design into Bigpowers process documents that:

- Separate fixture-only portability repairs from the audit production TDD cycle
- Preserve behavioral RED/GREEN discipline for the audit defect
- Avoid `.cmd` fixtures and hard-coded shell paths
- Keep all verification invocations repository-root-relative and Bash-compatible
- Include Windows Git Bash and a POSIX environment in the verification matrix
- Keep changes minimal to the five affected test assertions and the audit alias/retention boundary
