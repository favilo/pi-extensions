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

## 7. Preconditions
- The repository has the Pi SDK dependency installed.
- The spike remains isolated from production extension registration.

## 8. Inputs
- Child working directory, parent context, task text, SDK session options, and deterministic test doubles.

## 9. Outputs
- A disposable proof harness, observed lifecycle results, and a recorded production contract.

## 10. Quality attributes
- Deterministic cleanup, fail-closed permission behavior, bounded resource use, and reproducible tests.

## 11. Interfaces and contracts
- `AgentSession` creation and disposal; session events; tool-call interception; explicit cwd; cancellation propagation.

## 12. State
- A child session exists only for the duration of the proof and is disposed on success, failure, or cancellation.
- **Reviewed control surface:** Hybrid command + sidebar.
- `/subagents list` is the canonical keyboard-first view; a toggleable sidebar mirrors active children for monitoring and steering.
- The first UI slice shows name/status, cwd/elapsed time, progress/last event, and abort/resume.
- Steering uses `/subagents steer`; the sidebar supplies the target name, with tab completion and stable short IDs for duplicate names.
- The launch tool accepts an optional name; omitted names use short generated color-animal names.
- The parent owns the child lifecycle; permission decisions are delegated to the existing `tool-permissions` extension and passed through it to the user.
- Review artifact: `.lavish/e06s01-subagent-interaction.html`.
- **Reviewed interaction contract:** Parent-controlled bridge.
- The parent owns the child lifecycle, can abort it at any time, receives normalized lifecycle events, and receives a structured child result.
- Permission decisions remain delegated to the existing `tool-permissions` extension; the subagent layer must not recreate policy evaluation.
- Review artifact: `.lavish/e06s01-subagent-interaction.html`.
- User rationale: the parent must be able to abort the child at any time.
- No unresolved review feedback was submitted.

## 13. Dependencies
- `[OK] @earendil-works/pi-coding-agent` — existing project dependency and SDK under evaluation.
- Existing `tool-permissions` hooks; no new package.

## 14. Failure modes
- Session construction failure, missing model/auth, child tool bypass, leaked session, cancellation race, and unavailable UI.

## 15. Observability
- Tests record lifecycle events, child result, interception outcome, cancellation, cwd, and cleanup state without secrets.

## 16. Impact
- Net-new isolated spike; no existing production caller or permission contract is changed.

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

## 19. Implementation steps
1. Build a disposable AgentSession proof with deterministic lifecycle assertions → verify: node --test extensions/subagent/agent-session.test.ts
2. Characterize interception, nesting, cancellation, cwd, cleanup, and missing-UI behavior → verify: node --test extensions/subagent/agent-session.test.ts
3. Record the reviewed interaction direction and runtime contract in the spike specification → verify: test -f .specs/epics/e06-permission-enforced-subagents/e06s01-agent-session.md
4. Run package type and regression checks → verify: npm run check

## 20. Definition of done
A runnable AgentSession proof, interaction review artifact, captured user decision, and implementation-ready runtime/permission contract exist; no production bypass is introduced.
