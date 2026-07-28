# e03s01 — Apply trusted hierarchical project permission policy

## 1. Identity
- **Story:** e03s01
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 5
- **Risk:** P0

## 2. User need
A Pi user needs commands allowed for one trusted project hierarchy without granting the same commands in unrelated directories.

## 3. Goal
Apply trusted `.pi/permissions.toml` policy from the working directory and eligible ancestors through the nearest Git or Jujutsu repository root, with nearest matching project decisions taking precedence and user policy as fallback.

## 4. Non-goals
- Searching above the nearest repository root toward `$HOME`.
- Integrating permission rules into Pi's JSON settings.
- Supporting unpersisted, session-only, or CLI-only trust provenance.
- Changing permission-prompt shortcuts.

## 5. Users
Pi users who maintain different tool-permission policies for different trusted repositories or subdirectories.

## 6. User journey
A user explicitly trusts a project or parent, writes a project permission rule, starts Pi from the project or a descendant, and receives the project-specific decision without changing global behavior elsewhere.

## 7. Preconditions
- The tool-permissions extension is enabled.
- Pi's persisted trust store contains an applicable explicit decision.
- Project policy files use the existing permission TOML schema.

## 8. Inputs
Working directory, canonical ancestor paths, `.git` or `.jj` boundary markers, persisted Pi trust entries, project permission files, user permission file, tool name, and tool arguments.

## 9. Outputs
One effective permission decision: allow, deny, or prompt, plus enough source metadata for accurate auditing and UI messages.

## 10. Requirements
### ADDED: Repository-bounded project policy discovery
The extension shall discover project policy from the working directory upward through the nearest directory containing `.git` or `.jj`. Outside a repository, only the working directory is eligible.

### ADDED: Persisted trust eligibility
The extension shall use the nearest explicit persisted Pi trust decision. A trusted parent covers descendants, a nearer denial blocks inherited trust, and policy above the matched trusted path is ineligible.

### ADDED: Layered project precedence
Within one file, deny shall precede allow. Across project files, the nearest matching decision shall win. A matching project decision shall precede user policy; user policy shall remain the fallback when every eligible project policy returns prompt.

### ADDED: Replaceable trust resolver
Trust-store access shall be isolated behind a narrow internal contract so a future supported Pi trust API can replace direct file access without changing permission evaluation.

### ADDED: Trust failure fallback
Missing, malformed, denied, or unreadable persisted trust shall make project policy ineligible while preserving existing user-policy behavior.

### ADDED: Eligible project policy failure
A missing project policy file shall be ignored. An eligible policy file that exists but is malformed or unreadable shall produce a warning prompt in interactive mode and block the tool call in non-interactive mode; evaluation shall not continue to broader project or user policy.

## 11. Quality attributes
Deterministic precedence, canonical path safety, explicit trust, backward compatibility, independently testable policy resolution, and no new runtime dependency.

## 12. Interfaces and contracts

**Purpose:** Convert directory context, persisted trust, project policy, and user policy into one permission decision.

**Callers:** Every tool-specific permission handler in `extensions/tool-permissions/index.ts`.

**Contracts:** Existing `PermissionRule`, `ToolPermission`, and permission-key mapping remain stable. Scoped resolution returns plain data containing the decision, source scope/path, and optional configuration diagnostic. Callers do not depend on trust-store file structure.

**Reason for depth:** One new `scope.ts` module isolates filesystem/trust compatibility from the existing TOML primitives and large event adapter; plain records and injected filesystem functions avoid a class hierarchy while keeping the security boundary independently testable.

## 13. State
Configuration is read from disk for the current tool call or through an invalidation-safe cache. No project trust decision is persisted by this story.

## 14. Dependencies
- `[EXTEND] extensions/tool-permissions/config.ts` — existing TOML schema, matching, and atomic persistence.
- `[COMPOSE] CONFIG_DIR_NAME and getAgentDir()` — rebrand-safe project and user paths.
- `[INTERNAL ADAPTER] Pi persisted trust store` — initial trust provenance source, isolated for replacement.
- `[EXTEND] extensions/local-agent-context/index.ts` traversal precedent — repository-boundary behavior.
- No new package.

## 15. Failure modes
Symlink escape, incorrect repository boundary, loading policy above the trusted path, treating automatic trust as explicit trust, a nearer denial being ignored, malformed TOML falling through to a broader allow, or local absence changing existing user decisions.

## 16. Observability
Audit entries identify whether the effective decision came from project policy, user policy, `.aiignore`, interactive approval, or non-interactive denial without leaking complete configuration contents.

## 17. Acceptance criteria
### Scenario: Trusted parent policy applies to a descendant
**Given** a persisted trusted parent, a project policy beneath that trusted path, and Pi running in a descendant directory
**When** a tool call matches the project rule
**Then** the project decision applies.

### Scenario: Nearest project decision wins
**Given** conflicting matching project decisions in a repository root and a nearer directory
**When** Pi runs beneath the nearer directory
**Then** the nearer decision wins.

### Scenario: Project decision wins over user policy
**Given** a matching project allow and user deny, or a project deny and user allow
**When** the project policy is eligible
**Then** the project decision wins.

### Scenario: User policy remains fallback
**Given** eligible project policy files with no matching rule
**When** user policy matches the tool call
**Then** the user decision applies.

### Scenario: Nearer trust denial blocks inheritance
**Given** a trusted parent and a nearer persisted denial
**When** Pi runs beneath the denied path
**Then** no project policy is loaded and user behavior remains unchanged.

### Scenario: Policy exceeds a boundary
**Given** policy above the nearest repository root or above the matched trusted path
**When** project policy is discovered
**Then** that policy is ignored.

### Scenario: Trust data is invalid
**Given** missing, malformed, denied, or unreadable persisted trust data
**When** a tool call is evaluated
**Then** project policy is ineligible and existing user policy remains the fallback.

### Scenario: Eligible project policy is invalid interactively
**Given** an eligible project policy file exists but is malformed or unreadable and Pi has interactive UI
**When** a tool call is evaluated
**Then** Pi shows a warning prompt and does not continue to broader project or user policy automatically.

### Scenario: Eligible project policy is invalid non-interactively
**Given** an eligible project policy file exists but is malformed or unreadable and Pi has no interactive UI
**When** a tool call is evaluated
**Then** the tool call is blocked.

### Scenario: No repository exists
**Given** Pi runs outside Git and Jujutsu repositories
**When** project policy is discovered
**Then** only the working directory's project policy can be eligible.

## 18. Automated verification
- `node --test extensions/tool-permissions/config.test.ts`
- `node --test extensions/tool-permissions/scope.test.ts`
- `node --test extensions/tool-permissions/index.test.ts`
- `npm run check`

## 19. Implementation steps
1. Characterize existing user-only decisions and build a fake Pi tool-call harness covering read-family, write-family, bash, subagent, known MCP, and unknown-tool routing → verify: `node --test extensions/tool-permissions/index.test.ts`
2. Add `scope.ts` with plain-data discovery/trust results and injected filesystem boundaries; cover `.git`, `.jj`, no-repository, canonical containment, parent trust, nearer denial, malformed trust, and policy exclusion above the trusted path → verify: `node --test extensions/tool-permissions/scope.test.ts`
3. Resolve eligible policies nearest-first; return the first project allow/deny, fall back to user only after project prompts, preserve user fallback on trust failure, and return a configuration diagnostic instead of falling through when an eligible file cannot be read or parsed → verify: `node --test extensions/tool-permissions/scope.test.ts`
4. Replace the single-path `configuredDecision()` with the scoped resolver in every tool handler; include decision source in audit entries, route eligible project diagnostics to a warning prompt with UI, and block them without UI → verify: `node --test extensions/tool-permissions/index.test.ts`
5. Delete superseded single-path decision code and run all type and regression checks → verify: `npm run check`

## 20. Definition of done
Trusted project policy works from repository roots and descendants, nearest matching decisions are deterministic, trust failures preserve user behavior, eligible project-policy failures prompt interactively and block non-interactively, every tool handler uses the same resolver, and existing user-only behavior remains green.
