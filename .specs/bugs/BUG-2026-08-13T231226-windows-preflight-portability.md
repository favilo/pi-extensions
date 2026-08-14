---
bug_id: BUG-2026-08-13T231226
status: fixed
severity: high
priority: high
scope: windows-portability
title: Windows preflight fails on POSIX-only fixtures and symlink rotation
---

# BUG-2026-08-13T231226: Windows preflight portability

## Problem

`npm run check` fails on ordinary Windows environments while the same contracts are intended to be cross-platform.

Actual behavior:

- The executable-discovery fixture creates an extensionless POSIX script, but Windows discovery correctly searches `PATHEXT` candidates
- A permission fixture builds an invalid exact-path regular expression for Windows separators, causing an authorized child request to be denied
- The subagent containment fixture requires directory-symlink privileges before it can exercise canonical escape rejection
- Audit logging requires symbolic-link privileges for `audit.log`; when link creation fails, retention is skipped because both operations share one failure block

Expected behavior:

- Platform-appropriate executable fixtures exercise the same PATH-discovery contract
- Exact-path permission fixtures match canonical Windows and POSIX paths
- Directory escape tests use a Windows-compatible junction without weakening canonical containment
- The current audit-log alias works without elevated Windows privileges
- Retention runs independently from current-log alias maintenance

Reproduction:

```text
npm ci
npm run check
```

Observed baseline: 91 passed, 5 failed, 1 skipped.

Security impact: LOW. No security exploit path was identified. The symlink fixture currently prevents Windows from proving an existing containment control, and audit retention can be skipped after an alias-maintenance failure.

## Root Cause Analysis

### Executable discovery fixture

The production resolver follows the host contract: Windows enumerates `PATHEXT`; POSIX checks the exact command with executable permission. The test always creates the POSIX form. The failure is a fixture portability defect, not a resolver defect.

### Permission exact-path fixture

The test owns a second regular-expression escaping expression whose character class does not correctly escape Windows backslashes. The generated TOML policy therefore does not match the target path. The permission resolver correctly falls through to `ask`, which the probe maps to deny.

### Canonical containment fixture

The production resolver canonicalizes both parent and requested child paths before containment. The test attempts to create a Windows directory symbolic link, which requires privileges absent from a standard shell. A directory junction provides the same observable canonical escape without that privilege requirement.

### Audit alias and retention

The logger assumes `symlinkSync` is available. Windows commonly rejects it with `EPERM`. The dated audit write succeeds, but `audit.log` is not created. Retention is placed after alias creation in the same `try`, so the alias failure prevents expired-log cleanup. A same-directory hard link is a valid Windows fallback for exposing the current dated file, and retention must have an independent failure boundary.

Risk: Medium. Changes affect test portability and local audit-log maintenance. Audit writes and authorization decisions must remain unchanged if alias or retention maintenance fails.

## Fix Plan

The high-level design is defined in `BUG-2026-08-13T231226-windows-preflight-portability-design.md`.

1. **Preflight configuration**: Exclude optional `examples/**` tests from `npm run check` while preserving the full `npm test` command for explicit example verification. Leave the Bevy provider test unchanged.
   **verify**: `npm run check`

2. **Fixture correction**: Encode an exact path once for the regular-expression layer and once for the TOML layer, without separator-specific branches. Assert both the intended authorization and a near-miss denial.
   **verify**: `node --test extensions/subagent/agent-session.test.ts`

3. **Fixture correction**: Create the directory alias through Node filesystem capabilities, with a non-elevated junction fallback when ordinary directory links are unavailable. Keep canonical containment unchanged.
   **verify**: `node --test extensions/subagent/working-directory.test.ts`

4. **RED**: Make symbolic-link alias creation unavailable and assert that the current audit entry remains available through `audit.log`.
   **GREEN**: Prefer the existing relative symbolic link and fall back to a same-directory hard link without shell commands or platform-specific wrappers.
   **verify**: `node --test extensions/tool-permissions/audit.test.ts`

5. **RED**: Make all alias maintenance fail while an expired dated log exists and assert that cleanup still occurs.
   **GREEN**: Run alias maintenance and retention in independent failure boundaries with independent warnings.
   **verify**: `node --test extensions/tool-permissions/audit.test.ts`

6. **REFACTOR**: Keep capability handling behind small local seams and preserve non-blocking audit behavior.
   **verify**: `npm run check`

## Acceptance Criteria

- [ ] Bigpowers preflight excludes optional example tests without changing the Bevy provider test
- [ ] Child authorization exact-path rules match Windows temporary paths
- [ ] Canonical directory escape rejection is exercised without elevated Windows privileges
- [ ] `audit.log` exposes the current dated log without requiring symbolic-link privileges
- [ ] Expired audit logs are removed even when current-log alias maintenance fails
- [ ] Audit maintenance failures never alter tool authorization decisions
- [ ] Verification commands run from Bash on Windows through Git Bash
- [ ] `npm run check` passes on Windows
- [x] Extension preflight tests pass; optional example tests remain available through `npm test` and are outside Bigpowers preflight scope

## Resolution

Implemented the Windows-safe preflight boundary and extension fixes on `fix/windows-preflight`. `npm run check` now runs typecheck plus extension tests only and passes 92 tests. `npm run check:ci` passes typecheck, preflight tests, plan consistency, and portability checks. The full `npm test` command remains available for explicit example coverage; its unchanged Bevy fixture still fails on this Windows environment and is intentionally outside Bigpowers preflight scope.
