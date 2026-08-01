<!-- story: e03s03 -->
# e03s03 — Edit project or user permission policy explicitly

## 1. Identity
- **Story:** e03s03
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 2
- **Risk:** P0

## 2. User need
A Pi user needs to open the intended permission policy directly instead of remembering file paths or risking edits at the wrong scope.

## 3. Goal
Extend `/permissions` with explicit `user` and `local` arguments while preserving the bare command's existing user-policy behavior.

## 4. Non-goals
- Building an in-TUI policy editor.
- Selecting or editing an ancestor directory's project policy.
- Changing Ctrl+E pattern editing.
- Searching above the repository root toward `$HOME`.

## 5. Users
Interactive Pi users who manually inspect or edit user and current-directory permission rules.

## 6. User journey
A user enters `/permissions user` or `/permissions local`, Pi validates the selected scope, opens the correct TOML file in the external editor, and resumes after the editor closes.

## 7. Preconditions
- The tool-permissions extension is enabled in TUI mode.
- An external editor is available.
- E03s01 trust eligibility is available for local scope.

## 8. Inputs
Command argument, current working directory, persisted trust eligibility, user configuration path, project configuration path, and editor process result.

## 9. Outputs
The selected TOML file is opened or created for editing, or a clear error is shown without changing policy.

## 10. Requirements
### MODIFIED: Bare permissions command
**Before:** `/permissions` opens `~/.pi/agent/permissions.toml`.

**After:** Bare `/permissions` continues to open `~/.pi/agent/permissions.toml` as a backward-compatible alias for `/permissions user`.

### ADDED: User policy editor
`/permissions user` shall open the existing user permission TOML.

### ADDED: Local policy editor
`/permissions local` shall open `<cwd>/.pi/permissions.toml` only when the current directory is covered by eligible persisted Pi trust.

### ADDED: Invalid argument handling
Unsupported or extra arguments shall not open a file and shall show concise usage for `user` and `local`.

### ADDED: Safe editor failure
Failure to create the target, launch the editor, or save successfully shall report an error without claiming the policy changed.

## 11. Quality attributes
Backward compatibility, explicit scope, trust enforcement, clear errors, and no new dependency.

## 12. Interfaces and contracts

**Purpose:** Resolve a `/permissions` command argument to one eligible policy path and delegate to the existing external-editor lifecycle.

**Callers:** Pi's extension command dispatcher and interactive users.

**Contracts:** Bare and `user` select user scope; `local` selects only the current working directory and requires e03s01 trust eligibility; invalid input performs no file I/O.

**Reason for depth:** Scope resolution should be a small explicit helper because choosing the wrong file can widen authorization and both command and shortcut flows must share project-path eligibility.

## 13. State
The command creates an empty target file when eligible and absent, then leaves all content changes to the external editor.

## 14. Dependencies
- `[EXTEND] editPermissionsInExternalEditor` — existing editor stop/start lifecycle.
- `[COMPOSE] E03s01 trust and current-directory project-path resolution` — no duplicate trust parsing.
- `[OK] Pi ExtensionCommandContext` — existing command and UI API.
- No new package.

## 15. Failure modes
Opening user policy for a local request, opening local policy without trust, editing an ancestor accidentally, accepting ambiguous arguments, or reporting success after editor failure.

## 16. Observability
The command description, working message, and error notification identify the selected scope and exact target path.

## 17. Acceptance criteria
### Scenario: Bare command remains compatible
**Given** interactive Pi
**When** the user runs `/permissions`
**Then** the user permission file opens.

### Scenario: User scope is explicit
**Given** interactive Pi
**When** the user runs `/permissions user`
**Then** `~/.pi/agent/permissions.toml` opens.

### Scenario: Eligible local scope opens
**Given** cwd is covered by eligible persisted trust
**When** the user runs `/permissions local`
**Then** the current directory's `.pi/permissions.toml` opens or is created.

### Scenario: Ineligible local scope is refused
**Given** cwd is not covered by eligible persisted trust
**When** the user runs `/permissions local`
**Then** no project file is created or opened and the UI explains the refusal.

### Scenario: Argument is invalid
**Given** an unsupported or extra argument
**When** `/permissions` runs
**Then** no file is opened and usage is shown.

### Scenario: Editor fails
**Given** target creation or editor launch fails
**When** a valid scoped command runs
**Then** the UI reports failure and does not claim the policy changed.

## 18. Automated verification
- `node --test extensions/tool-permissions/index.test.ts`
- `node --test extensions/tool-permissions/documentation.test.ts`
- `npm run check`

## 19. Implementation steps
1. Add red command contracts for bare, user, local, invalid, untrusted, and editor-failure cases → verify: `node --test extensions/tool-permissions/index.test.ts`
2. Resolve command scope to an eligible target and reuse the external-editor lifecycle → verify: `node --test extensions/tool-permissions/index.test.ts`
3. Document scoped editor commands → verify: `node --test extensions/tool-permissions/documentation.test.ts`
4. Run package regression and type checks → verify: `npm run check`

## 20. Definition of done
All three supported command forms target the documented file, local scope is trust-gated and cwd-specific, invalid or failed operations perform no misleading mutation, and existing bare-command behavior remains compatible.
