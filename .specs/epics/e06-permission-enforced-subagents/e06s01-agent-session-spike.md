# e06s01 — Spike AgentSession runtime and subagent interaction model

## 1. Identity
- **Story:** e06s01
- **Type:** spike
- **Maturity:** 3 — Countable
- **BCPs:** 3
- **Risk:** P0
- **Delta:** ADDED

## 2. User need
The project needs a concrete, tested way to run child agents before it commits to a production subagent tool.

## 3. Goal
Explore Pi's `AgentSession` SDK and produce a runnable proof plus a durable specification for lifecycle, nesting, cancellation, context inheritance, child cwd, tool interception, and subagent-facing interaction. The existing permissions UI is reused; this spike explores the subagent UI and runtime experience, not a replacement permissions prompt.

## 4. Non-goals
- Production subagent execution.
- Replacing the existing tool-permissions UI.
- Allowing a child action to bypass permission checks.
- Selecting a Bash parser.

## 5. Requirements
- Exercise `AgentSession` creation and disposal in a child working directory.
- Prove how child tool calls reach extension hooks and identify any bypass path.
- Explore parent/child messages, progress, cancellation, failure, and nested-agent behavior.
- Use a Lavish interactive artifact for the subagent interaction options and capture the review outcome in the resulting specification.
- Record unresolved SDK limitations and a recommended production contract.

## 6. Failure modes
SDK lifecycle leaks, child calls bypassing extensions, unavailable model/auth context, cancellation leaving a child running, missing UI, nested recursion, and cwd drift.

## 17. Acceptance criteria
### Scenario: SDK proof
**Given** the project can construct an `AgentSession`
**When** the spike runs a child turn
**Then** it records the lifecycle and child result without leaking a live session.

### Scenario: Permission interception
**Given** the child requests a tool call
**When** the extension hooks are observed
**Then** the spike identifies whether the existing tool-permissions boundary can inspect and block it.

### Scenario: Interaction review
**Given** multiple subagent interaction options
**When** the user reviews the Lavish artifact
**Then** the selected direction and unresolved feedback are captured in the spike specification.

## 18. Automated verification
- `node --test extensions/subagent/*.test.ts`
- `npm run check`

## 19. Definition of done
A runnable AgentSession proof, interaction review artifact, captured user decision, and implementation-ready runtime/permission contract exist; no production bypass is introduced.
