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
Implement a runnable subagent tool using the e06s01 AgentSession contract. Every child action must be evaluated by the existing tool-permissions extension before execution. Matching deny rules deny without asking, matching allow rules execute without asking, and the default decision is ask when neither rule matches.

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

## 7. Preconditions
- The e06s01 runtime contract is accepted and the existing permission evaluator is available.

## 8. Inputs
- Child tool request, effective cwd, parent context, policy decision, and UI availability.

## 9. Outputs
- Structured child result and an audited allow, deny, cancellation, or failure decision.

## 10. Quality attributes
- Fail-closed authorization, no duplicate policy implementation, bounded nesting, and deterministic cleanup.

## 11. Interfaces and contracts
- AgentSession-backed child execution delegates every capability request to the existing tool-permissions boundary.
- `ToolRequest` is shared by main and child callers and carries a typed actor (`main` or `child`), tool name, input, cwd, and optional steering context.
- The permission boundary is owned by `extensions/tool-permissions/`; child runtime code consumes it and does not define a second policy evaluator or audit sink.
- Policy resolution always uses the existing tool-permissions defaults with the request cwd as scope; child runtime callers cannot override policy paths.

## 12. State
- Child sessions and in-flight tool calls are owned by the parent invocation and are cleaned up on every terminal outcome.
- The shared boundary maps existing resolver decisions as allow, deny, or ask; matching allow and deny rules bypass prompting, while unmatched requests ask.

## 13. Dependencies
- `[OK] @earendil-works/pi-coding-agent` — existing SDK dependency.
- Existing `extensions/tool-permissions/` evaluator and audit logger; no new package.

## 14. Failure modes
- Unknown tool, denied request, policy read failure, bypass attempt, child crash, cancellation, and missing UI.

## 15. Observability
- Audit tool, decision, effective cwd, child identity, and safe reason; never persist secret-bearing input.

## 16. Impact
- Extends the permission boundary and introduces a new caller; the boundary must remain the single authorization point.

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

## 19. Implementation steps
1. Add contracts proving child calls reach the evaluator and audit logger → verify: node --test extensions/tool-permissions/permission-boundary.test.ts
2. Implement AgentSession-backed execution with default ask, deny, results, and cleanup → verify: node --test extensions/tool-permissions/permission-boundary.test.ts
3. Cover SDK and process bypass paths → verify: node --test extensions/tool-permissions/permission-boundary.test.ts
4. Run package regression checks → verify: npm run check

## 20. Definition of done
Runnable subagents use AgentSession, all child capabilities cross tool-permissions, default-ask and deny-list behavior are covered, and child agents receive actionable results.

## 21. Implementation and UAT handoff
- Child sessions expose only `subagent-tool-request`; parent-side tool definitions remain authoritative.
- Parent validates bridged input against the published TypeBox schema before permission evaluation or execution.
- Child sessions use an extension-free `DefaultResourceLoader` to prevent duplicate permission hooks.
- Published built-in-renderer and MCP definitions are available through `extensions/tool-registry/`.
- UAT harness: `scripts/e06s02-uat.sh {allowed|denied|unlisted}`.
- Real UAT results on 2026-08-06: allowed `ls -l` executed and returned output; deny-list returned structured `Permission denied.`; unlisted returned structured `Permission denied by the user.`. Debug traces confirmed child identity, cwd, validation, prompt path, and extension isolation.
- `npm run check` passes with 88 tests.
- Remaining next-session work: write `.specs/verifications/e06s02-verify.yaml`, record P0 security/NFR/completeness evidence, and run audit-code before changing the story status.
