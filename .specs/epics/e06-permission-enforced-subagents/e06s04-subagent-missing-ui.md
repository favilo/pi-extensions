# e06s04 — Handle subagent permission asks when the main UI is unavailable

## 1. Identity
- **Story:** e06s04
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 2
- **Risk:** P0
- **Delta:** ADDED

## 2. User need
A subagent must not silently gain permission when an action requires asking but no interactive UI is available to answer the request.

## 3. Goal
Make an unlisted subagent action attempt the normal ask path and return a structured unavailable-UI result when the main permission UI cannot receive the request. The action must not execute merely because the UI is missing.

## 4. Non-goals
- Replacing the existing permission prompt.
- Automatically allowing unlisted actions in headless mode.
- Adding a second permission configuration format.
- Treating a missing UI as a deny-list rule.

## 5. Requirements
- Preserve default-ask semantics for actions not explicitly allowed or denied.
- Forward asks to the main permission UI whenever it is available.
- When no UI is available, return a safe structured result explaining that approval could not be obtained.
- Include the tool, effective cwd, action summary, and steering description in the result where safe.
- Do not execute the action, persist an allow rule, or weaken the deny-list boundary after an unavailable-UI result.
- Make cancellation distinct from unavailable UI.

## 6. Failure modes
Headless execution, UI disconnect, prompt cancellation, parent shutdown, malformed child request, and repeated ask attempts.

## 7. Preconditions
- The existing permission evaluator distinguishes explicit rules from interactive asks.

## 8. Inputs
- Child tool request, effective cwd, policy decision, UI availability, and cancellation state.

## 9. Outputs
- Structured allow, deny, cancellation, unavailable-UI, or failure result; no unauthorized action execution.

## 10. Quality attributes
- Fail-closed headless behavior, clear result distinctions, and no policy mutation on refusal.

## 11. Interfaces and contracts
- Available UI reuses the existing prompt; unavailable UI denies unlisted actions while explicit rules remain authoritative.

## 12. State
- A pending ask is resolved once and cannot be retried into an implicit allow after UI loss or cancellation.

## 13. Dependencies
- Existing `tool-permissions` prompt and evaluator; no new package or configuration format.

## 14. Failure modes
- Headless execution, UI disconnect, cancellation, malformed request, parent shutdown, and repeated asks.

## 15. Observability
- Audit safe tool, decision, cwd, and result category without recording secrets or raw prompts.

## 16. Impact
- Hardens a new subagent caller against fail-open behavior; existing user-only permission behavior remains unchanged.

## 17. Acceptance criteria
### Scenario: Main UI available
**Given** an unlisted subagent action and an available main permission UI
**When** the action is requested
**Then** the existing permission UI asks the user before execution.

### Scenario: Main UI unavailable
**Given** an unlisted subagent action and no available main permission UI
**When** the action is requested
**Then** the action does not execute and the subagent receives a structured unavailable-UI result.

### Scenario: Explicit allow remains automatic
**Given** an action matches an allow rule
**When** the main UI is unavailable
**Then** the action follows the existing allow-rule behavior and does not require a new prompt.

### Scenario: Explicit deny remains automatic
**Given** an action matches a deny rule
**When** the main UI is unavailable
**Then** the action is denied with the deny-list reason.

### Scenario: Cancellation is distinct
**Given** the main UI receives an ask and the user cancels
**When** the result returns to the child
**Then** it reports cancellation rather than unavailable UI and does not execute the action.

## 18. Automated verification
- `node --test extensions/subagent/missing-ui.test.ts`
- `node --test extensions/tool-permissions/index.test.ts`
- `npm run check`

## 19. Implementation steps
1. Add contracts for default asks, available UI, unavailable UI, cancellation, allow, and deny → verify: node --test extensions/subagent/missing-ui.test.ts
2. Return structured unavailable-UI and cancellation results without executing unapproved actions → verify: node --test extensions/subagent/missing-ui.test.ts
3. Verify compatibility with existing prompt, allow, deny, and audit behavior → verify: node --test extensions/tool-permissions/index.test.ts
4. Run package type and regression checks → verify: npm run check

## 20. Definition of done
Default asks reach the existing UI when possible, missing UI cannot become an authorization bypass, and child agents receive actionable distinctions between unavailable UI, cancellation, allow, and deny.
