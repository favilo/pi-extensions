# e06s02 — Run subagents through the tool-permissions boundary

## 1. Identity
- **Story:** e06s02
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 4
- **Risk:** P0
- **Delta:** ADDED

## 2. User need
A subagent must not gain capabilities that the main agent could not use under the repository's permission policy.

## 3. Goal
Implement a runnable subagent tool using the e06s01 AgentSession contract. Every child action must be evaluated by the existing tool-permissions extension before execution. The default decision is ask; only matching deny rules deny without asking.

## 4. Non-goals
- A second permission policy format.
- A replacement permission prompt.
- Silent trust of child-generated allow rules.
- Bash subcommand decomposition; that belongs to e07.

## 5. Requirements
- Forward child tool calls through the same policy evaluator and audit logger.
- Preserve tool input, child cwd, parent context, and steering description in permission requests.
- Return structured allow, deny, cancellation, and failure results to the child agent.
- Prevent direct SDK, process, or shell execution paths from bypassing the boundary.
- Enforce maximum depth and cleanup rules defined by the spike contract.

## 6. Failure modes
Unknown child tools, denied actions, prompt cancellation, unavailable UI, child crash, parent cancellation, policy read failure, and attempted bypass.

## 17. Acceptance criteria
### Scenario: Unlisted child action
**Given** a child requests an action with no matching allow or deny rule
**When** the child action is evaluated
**Then** the existing permission UI asks the user before execution.

### Scenario: Deny-list child action
**Given** a child action matches a deny rule
**When** the child requests it
**Then** the action is not executed and the child receives the denial reason.

### Scenario: Allowed child action
**Given** a child action matches an allow rule
**When** the child requests it
**Then** it executes without a duplicate prompt and is audited.

### Scenario: Bypass attempt
**Given** a child attempts an execution path outside normal tool calls
**When** the runtime handles it
**Then** the path is blocked or unavailable and the event is reported safely.

## 18. Automated verification
- `node --test extensions/subagent/*.test.ts`
- `node --test extensions/tool-permissions/*.test.ts`
- `npm run check`

## 19. Definition of done
Runnable subagents use AgentSession, all child capabilities cross tool-permissions, default-ask and deny-list behavior are covered, and child agents receive actionable results.
