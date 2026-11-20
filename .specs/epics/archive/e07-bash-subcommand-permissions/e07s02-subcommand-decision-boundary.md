# e07s02 — Allowlist individual Bash subcommands and deny whole commands safely

## 1. Identity
- **Story:** e07s02
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 4
- **Risk:** P0
- **Delta:** ADDED

## 2. User need
Users need to allow safe command units such as `jj status`, `jj diff --stat`, and `jj diff --summary` without allowlisting every compound Bash string.

## 3. Goal
Evaluate parsed Bash subcommands independently against the existing Bash permission rules. If every subcommand is allowed, the complete command may execute. If any subcommand is denied or cannot be safely evaluated, the complete invocation is denied.

## 4. Non-goals
- Allowing partial execution of a compound command.
- Treating parser output as a replacement for shell semantics.
- Changing permissions for non-Bash tools.
- Auto-allowing unsupported syntax.

## 5. Requirements
- Generate stable permission inputs for individual subcommands.
- Preserve argument boundaries and explicit `bash -c` payload semantics.
- Apply existing allow and deny precedence to each subcommand.
- Default an unlisted subcommand to ask; deny-list matches deny without asking.
- Make the complete command decision atomic: one denied component prevents all execution.
- Preserve the existing Bash permission result contract for callers.

## 6. Failure modes
One component denied, one component requiring an unavailable ask, parser failure, uncertain shell semantics, command substitution, and mismatch between normalized and executed text.

## 17. Acceptance criteria
### Scenario: All components allowed
**Given** `jj status && jj diff --stat`
**When** both subcommands match allow rules
**Then** the complete command executes once.

### Scenario: One component denied
**Given** a compound command with one deny-list match
**When** the command is evaluated
**Then** no component executes, the complete invocation is denied, and the denied subcommand is identified.

### Scenario: Unlisted component
**Given** a subcommand with no matching allow or deny rule
**When** it is evaluated
**Then** the existing permission UI asks before the complete command can execute.

### Scenario: Explicit bash -c
**Given** `bash -c 'jj status; jj diff --summary'`
**When** the payload is parsed and evaluated
**Then** each payload subcommand is checked before the outer invocation executes.

## 18. Automated verification
- `node --test extensions/tool-permissions/bash-subcommands.test.ts`
- `node --test extensions/tool-permissions/index.test.ts`
- `npm run check`

## 19. Definition of done
Individual Bash subcommands can be allowlisted, complete commands are atomic, deny-list and ask behavior are preserved, and explicit `bash -c` is covered by tests.
