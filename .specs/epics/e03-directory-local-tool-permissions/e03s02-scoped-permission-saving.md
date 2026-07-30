<!-- story: e03s02 -->
# e03s02 — Save permission rules to project or user scope

## 1. Identity
- **Story:** e03s02
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 3
- **Risk:** P0

## 2. User need
A Pi user responding to a permission prompt needs a fast, unambiguous choice between saving a rule for the current project directory and saving it for every project.

## 3. Goal
Make Ctrl+A allow and save to the current directory's project policy, and Ctrl+Shift+A allow and save to user policy, with accurate hints, feedback, steering behavior, and failure handling.

## 4. Non-goals
- Changing Ctrl+E pattern editing.
- Choosing a different ancestor as the save destination.
- Adding `$HOME` policy traversal.
- Migrating existing user rules.

## 5. Users
Interactive Pi users approving read, write, bash, subagent, or known MCP tool patterns.

## 6. User journey
A permission prompt appears, the user presses Ctrl+A for a project-only exception or Ctrl+Shift+A for a global exception, the rule is persisted to the displayed destination, and the current call proceeds.

## 7. Preconditions
- E03s01 project policy resolution is available.
- The current project path is eligible under persisted Pi trust for project saves.
- Pi is running in interactive TUI mode with pattern saving available.

## 8. Inputs
Suggested permission rule, tool permission key, current working directory, selected shortcut, optional steering text, trust eligibility, and target configuration path.

## 9. Outputs
An atomically persisted allow rule in project or user TOML, an allowed current call, an audit entry with scope, and clear user feedback.

## 10. Requirements
### MODIFIED: Ctrl+A allow-pattern behavior
**Before:** Ctrl+A persisted the suggested rule to the single user configuration.

**After:** Ctrl+A persists the suggested rule to the current directory's `.pi/permissions.toml` and allows the current call only after persistence succeeds.

### ADDED: Ctrl+Shift+A user save
Ctrl+Shift+A shall preserve the previous user-global allow-and-save capability using the existing user TOML path.

### MODIFIED: Steering variants
**Before:** steering mode exposed one Ctrl+A allow-and-save action.

**After:** steering mode exposes and correctly applies both project and user save scopes while preserving the steering message.

### MODIFIED: Prompt hints and feedback
**Before:** hints described a generic saved pattern.

**After:** hints and completion feedback distinguish project and user destinations without ambiguity.

### ADDED: Persistence failure safety
A failed or ineligible project save shall not be reported as saved and shall not allow the current call as though persistence succeeded.

## 11. Quality attributes
Fast keyboard interaction, visible scope, atomic persistence, consistent steering behavior, backward-compatible user storage, and fail-closed save handling.

## 12. Interfaces and contracts

**Purpose:** Map a permission prompt action to an explicit persistence scope.

**Callers:** The standard and steering branches of the custom permission component.

**Contracts:** Saving receives a scope or target path explicitly; no helper silently defaults to global persistence. The permission result and audit entry retain enough scope metadata to explain the action.

**Reason for depth:** A shortcut error can turn a narrow exception into a global authorization. Scope must be explicit at the UI, persistence, result, and audit boundaries.

## 13. State
The selected rule is appended atomically to one TOML file. Duplicate rules remain idempotent under existing persistence behavior.

## 14. Dependencies
- `[EXTEND] saveAllowedRule` — existing comment-preserving atomic TOML patching.
- `[EXTEND] askScrollablePermission` — existing custom prompt and steering component.
- `[COMPOSE] matchesKey` — supports `ctrl+a` and `ctrl+shift+a` shortcut matching.
- E03s01 trust eligibility and project-path resolution.
- No new package.

## 15. Failure modes
Reversed shortcuts, global save when local was selected, local save outside trusted scope, steering branch divergence, misleading hints, duplicate writes, or allowing after persistence failure.

## 16. Observability
Prompt hints display both scopes, success or error feedback identifies the target, and audit entries distinguish project-pattern from user-pattern persistence.

## 17. Acceptance criteria
### Scenario: Save a project rule
**Given** an eligible trusted current project directory and a suggested allow rule
**When** the user presses Ctrl+A
**Then** the rule is saved to the current directory's project policy and the call proceeds.

### Scenario: Save a user rule
**Given** a suggested allow rule
**When** the user presses Ctrl+Shift+A
**Then** the rule is saved to user policy and the call proceeds.

### Scenario: Save with steering
**Given** steering mode contains a non-empty message
**When** either scoped save shortcut is pressed
**Then** the selected rule is saved to the correct scope, the message is delivered as steering, and the call proceeds.

### Scenario: Project save is ineligible
**Given** the current directory is not covered by eligible persisted trust
**When** the user attempts Ctrl+A
**Then** no project rule is written, the call is not treated as persisted approval, and the UI reports the reason.

### Scenario: Persistence fails
**Given** the target TOML cannot be written or parsed safely
**When** either scoped save shortcut is pressed
**Then** the UI reports failure and the call is not allowed as a saved pattern.

### Scenario: Prompt communicates scope
**Given** pattern saving is available
**When** the permission prompt renders
**Then** Ctrl+A is labeled project/local and Ctrl+Shift+A is labeled user/global.

### Scenario: Duplicate rule already exists
**Given** the selected destination already contains the suggested rule
**When** the corresponding scoped shortcut is pressed
**Then** persistence remains idempotent and the current call proceeds.

## 18. Automated verification
- `node --test extensions/tool-permissions/index.test.ts`
- `node --test extensions/tool-permissions/documentation.test.ts`
- `npm run check`

## 19. Implementation steps
1. Add red component contracts for both scopes and steering → verify: `node --test extensions/tool-permissions/index.test.ts`
2. Route project and user saves explicitly and fail closed on write errors → verify: `node --test extensions/tool-permissions/index.test.ts`
3. Update documentation and verify its user-facing contract → verify: `node --test extensions/tool-permissions/documentation.test.ts`
4. Confirm package-wide behavior and types → verify: `npm run check`

## 20. Definition of done
Both shortcuts persist to the documented scope in normal and steering modes, failures cannot masquerade as approval, project saves respect e03s01 trust eligibility, documentation matches behavior, and the full package remains green.
