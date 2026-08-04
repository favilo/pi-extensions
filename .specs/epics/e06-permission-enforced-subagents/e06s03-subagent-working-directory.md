# e06s03 — Resolve permissions from each subagent working directory

## 1. Identity
- **Story:** e06s03
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 2
- **Risk:** P0
- **Delta:** ADDED

## 2. User need
A subagent should inherit the parent agent's working directory and permission context by default, while still being able to run in an explicitly selected child directory without bypassing normal recursive policy resolution.

## 3. Goal
Preserve the parent directory as the default subagent cwd and reuse the existing tool-permissions recursive resolution for any explicitly selected child cwd. This must work for arbitrary child directories, including directories created for alternate workspaces.

## 4. Non-goals
- Special-casing one workspace directory name.
- Adding a separate subagent policy file.
- Changing repository boundary or trust semantics outside the subagent cwd input.

## 5. Requirements
- Default the child session cwd to the parent session's cwd.
- When a child cwd is explicitly selected, pass it through the existing recursive policy resolver without a subagent-specific resolver.
- Preserve nearest repository and persisted-trust boundaries.
- Allow an explicitly selected child directory to inherit the applicable policy from its parent hierarchy.
- Ensure child policy decisions and audit entries identify the effective cwd.
- Reject missing, non-directory, or path-escape cwd inputs safely.

## 6. Failure modes
Symlink escape, missing cwd, parent/child policy mismatch, workspace policy lookup drift, and child cwd changing after startup.

## 7. Preconditions
- The subagent runtime accepts an explicit effective cwd and can pass it to policy evaluation.

## 8. Inputs
- Parent cwd, optional child cwd, filesystem canonicalization result, and trust/repository metadata.

## 9. Outputs
- A child session bound to a canonical cwd or a safe startup failure before tool execution.

## 10. Quality attributes
- Boundary preservation, symlink safety, deterministic resolution, and auditability.

## 11. Interfaces and contracts
- Default child cwd is the parent cwd; explicit child cwd uses the existing recursive permission resolver.

## 12. State
- Effective cwd is fixed for the child session and cannot drift after startup.

## 13. Dependencies
- Existing `tool-permissions/scope.ts` resolver; no new policy format or package.

## 14. Failure modes
- Missing directory, non-directory path, symlink escape, policy mismatch, and repository-boundary drift.

## 15. Observability
- Record effective canonical cwd and policy source in safe audit metadata.

## 16. Impact
- Adds cwd input to subagent execution while preserving existing trust and repository boundary contracts.

## 17. Acceptance criteria
### Scenario: Parent directory inheritance
**Given** a subagent starts without an explicit cwd
**When** it requests a tool
**Then** it uses the parent session's cwd and the existing recursive policy resolution.

### Scenario: Explicit child directory
**Given** a subagent starts in a nested directory with an applicable policy
**When** it requests a tool
**Then** the existing recursive resolver evaluates that effective cwd.

### Scenario: Alternate workspace directory
**Given** a child runs inside a directory used for an alternate workspace
**When** it requests a tool
**Then** normal policy discovery applies without a directory-name special case.

### Scenario: Boundary safety
**Given** a child cwd is outside the allowed execution context or escapes through a symlink
**When** the child starts
**Then** startup fails safely before tool execution.

## 18. Automated verification
- `node --test extensions/subagent/*.test.ts`
- `node --test extensions/tool-permissions/scope.test.ts`
- `npm run check`

## 19. Implementation steps
1. Add contracts for inherited and explicit cwd resolution → verify: node --test extensions/subagent/working-directory.test.ts
2. Route effective cwd through the existing recursive policy resolver → verify: node --test extensions/subagent/working-directory.test.ts
3. Cover nested, alternate-workspace, canonical-containment, and symlink failures → verify: node --test extensions/subagent/working-directory.test.ts
4. Run policy-scope regressions and package checks → verify: npm run check

## 20. Definition of done
Child cwd is canonical, policy-aware, auditable, and covered for nested, alternate-workspace, and boundary failures.
