# e03s01 Hierarchical Project Permission Policy — Impact Assessment

## Target

- `extensions/tool-permissions/config.ts`: permission loading, matching, decision precedence, and persistence contracts.
- `extensions/tool-permissions/index.ts`: shared `configuredDecision()` path used by every intercepted tool family.
- New trust-resolution boundary for Pi's persisted trust store.
- New repository-bounded discovery of `.pi/permissions.toml`.

## Zoom-out

### Purpose

The tool-permissions module converts tool names, normalized arguments, user policy, project context, and interactive approval into a fail-safe allow, deny, or prompt decision. It also persists approved rules and records audit events.

### Callers

- Pi loads `extensions/tool-permissions/index.ts` through `package.json` and invokes its `tool_call` handler.
- Read, grep, find, ls, write, edit, bash, subagent, known MCP, and unknown-tool branches call the shared permission decision path.
- `/permissions` opens the existing user-policy editor.
- The custom permission component saves approved patterns.
- `extensions/tool-permissions/config.test.ts` directly exercises the public configuration helpers.
- E03s02 will depend on the project-path and trust eligibility resolved by e03s01.

### Contracts

- `read`, `ls`, `grep`, and `find` share the `read` key; `write` and `edit` share `write`.
- Within one policy, matching deny rules take precedence over matching allow rules.
- Rule fields are ANDed, rule lists are ORed, and values are JavaScript regular expressions.
- Missing policy yields `prompt`; malformed policy never silently grants access.
- Existing user policy remains at `~/.pi/agent/permissions.toml` and retains current behavior when no eligible project policy matches.
- Every tool family must use the same scoped resolver; bypassing one handler would create a security hole.
- Audit failure never allows or blocks a call by itself.

## Dependents (12)

- `extensions/tool-permissions/index.ts`: `configuredDecision()`.
- `handlePathPermission()`: read/grep/find/ls decisions.
- `handleFileEditPermission()`: write/edit decisions.
- `handleBashPermission()`: shell command decisions.
- `handleSubagentPermission()`: delegation decisions.
- `handleUnknownToolPermission()`: known MCP decisions and unknown-tool prompts.
- `configuredDeny()`: denial audit behavior.
- `askScrollablePermission()`: project-save integration in e03s02.
- `/permissions`: existing user-editor path and messaging.
- `extensions/tool-permissions/config.test.ts`: current parser and precedence contracts.
- `README.md`: documented user configuration location and behavior.
- `.specs/epics/e03-directory-local-tool-permissions/e03s02-scoped-permission-saving.md`: downstream consumer of trust/path resolution.

## Affected Stories

- `e03s01`: owns hierarchical policy discovery, trust eligibility, and effective decision resolution.
- `e03s02`: requires e03s01's eligible current-directory destination and scoped decision metadata.
- Existing user-only behavior from the original packaged extension must remain compatible; no archived story is reopened unless regression tests fail.

## Test Coverage

Existing coverage:

- `extensions/tool-permissions/config.test.ts` covers TOML parsing, shared permission keys, deny-before-allow, AND/OR rule semantics, match-all rules, compact object matching, idempotent atomic saves, format preservation, and malformed rule rejection.
- Package-wide `npm run check` covers TypeScript and all extension tests.

Required coverage before implementation is accepted:

- Repository discovery for `.git` and `.jj`, including file or directory markers and no-repository behavior.
- Canonical path containment and policy exclusion above repository/trusted boundaries.
- Persisted nearest-ancestor trust: parent true, nearer false, no entry, malformed file, and unreadable file.
- Nearest matching project decision across multiple policy files.
- Project decision precedence over user policy and user fallback on project prompt.
- Trust-store failure disabling project policy while preserving user fallback.
- Eligible project-policy read/parse failure warning and prompting interactively, blocking non-interactively, and never falling through to broader policy automatically.
- Every tool family receiving decisions through the scoped resolver.
- Audit source metadata distinguishing project and user policy.

Coverage gaps:

- No current `extensions/tool-permissions/index.test.ts` exercises tool-event routing or `configuredDecision()` across all tool families.
- No current test covers Pi trust-store compatibility or ancestor project configuration.
- Direct trust-store format use is an internal compatibility risk and must be isolated behind fixtures and an adapter contract.

## Risk: High

This changes a shared authorization decision used by every tool call and introduces repository-controlled input plus an internal Pi trust-store dependency. A precedence, path, or trust error can silently authorize commands beyond the user's intended scope.

## Recommended action

Proceed only with contract-first TDD. Add trust/discovery/precedence tests before changing runtime behavior, route all tool families through one resolver, preserve user-only behavior as a regression suite, and keep trust-store parsing behind a replaceable adapter. E03s02 must not duplicate trust or project-path logic.
