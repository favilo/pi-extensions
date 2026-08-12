# e06s05 — Run observable subagents in the background

## 1. Identity
- **Story:** e06s05
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 5
- **Risk:** P0
- **Delta:** ADDED

## 2. User need
Users need subagents to continue working without blocking the foreground agent, while retaining enough observable activity to understand what each child is doing.

## 3. Goal
Start a child as a parent-owned background task, return its stable ID immediately, retain its exposed assistant and tool events, notify the parent when it finishes, and require explicit result retrieval.

## 4. Non-goals
- Persisting or resuming active children across Pi exit or `/reload`.
- Automatically injecting a child's full result into parent context.
- Exposing private provider reasoning that the SDK does not publish.
- Sending follow-up input to a running child; interactive steering is deferred.

## 5. Requirements

#### ADDED: Parent-owned observable background child lifecycle
- Return a generated, collision-resistant child task ID without awaiting the child turn.
- Track queued, running, waiting-for-permission, completed, failed, and cancelled states under one parent-session registry.
- Subscribe to published `AgentSessionEvent` values and retain ordered assistant text, tool calls, tool updates, tool results, and terminal outcomes through a project-owned normalized event contract.
- Keep child events out of parent model context until an explicit `subagent_result` request.
- Make `subagent_result` return the current structured status for incomplete children and a stable bounded result snapshot for terminal children; repeated retrieval is read-only.
- Send a fixed `subagent_finished` signal containing only generated child ID and enumerated terminal status into the parent's next natural turn without triggering a turn.
- Cancel, unsubscribe, await bounded cleanup, and dispose active children on parent cancellation or session shutdown for quit, reload, new, resume, and fork.
- Present all main-agent and child permission requests through one parent-session-owned FIFO queue; bind each waiter to immutable request ID, actor, tool name, cwd, and safe input identity so one decision can settle only its visible request.
- Attribute every child permission prompt visibly as `Subagent <generated-id> → <tool>` without persisting raw tool arguments or injecting them into parent model context.
- Apply the same cwd-aware permission model to child requests as main requests: configured denies win, configured allows execute without prompting, and reads/searches inside the child cwd auto-allow unless excluded by `.aiignore`.
- Until e06s06 permits multiple active children, continue to allow at most one active child even though main-versus-child prompts are serialized.
- Bound retained event count, per-event UTF-8 bytes, total UTF-8 bytes, retained terminal results, and cleanup time; truncation or limit failure must be explicit.
- Preserve Pi's existing child `SessionManager` as the sole durable child-message store; normalized events remain session-scoped memory only.

## 6. Failure modes
Session construction failure, background promise rejection, event-order races, result retrieval before completion, duplicate IDs, cancellation races, unbounded transcript growth, and shutdown with active children.

## 7. Preconditions
- Existing e06 child sessions and tool-permission bridge remain the only execution path.
- Pi exposes `AgentSession.subscribe()` events and parent custom-message delivery.

## 8. Inputs
Task, optional child name, child cwd, parent context, cancellation signal, and explicit child ID for status/result retrieval.

## 9. Outputs
Immediate task handle, bounded observable event stream, terminal status signal, and explicitly retrieved structured result.

## 10. Quality attributes
Foreground responsiveness, deterministic cleanup, ordered events, bounded memory, and no asynchronous parent-context mutation.

## 11. Interfaces and contracts
- The launch tool returns only after child ID allocation, registry insertion, cancellation ownership, permission-boundary construction, and event subscription; it does not await child completion.
- A parent-owned task registry is the authority for child state and result lookup. **Reason for Depth:** launch, retrieval, notification, and shutdown need one owner to reject stale callbacks and detached authorization consistently.
- `AgentSession.subscribe(listener): () => void` is adapted into a stable project event contract rather than leaked directly to UI code. **Reason for Depth:** one bounded adapter centralizes event ordering, terminal sealing, and secret-handling rules for retrieval and the e06s06 UI.
- Published SDK events used by the adapter include `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `agent_end`, and `agent_settled`.
- The public retrieval operation is `subagent_result({ id })`; before termination it returns status without fabricated output, and after termination it returns an atomic stable snapshot.
- `subagent_finished` is notification-only and is queued through `pi.sendMessage(..., { deliverAs: "nextTurn", triggerTurn: false })`; `subagent_result(id)` is authoritative for output.
- The registry is closed from Pi's `session_shutdown` event, whose declared reasons are quit, reload, new, resume, and fork.

## 12. State
Child state is in memory for the current parent session. Active state and buffered events may be discarded on exit or reload. Completed results remain retrievable until that parent session shuts down.

## 13. Dependencies
- `[OK] @earendil-works/pi-coding-agent` — existing dependency; `AgentSession.subscribe()` supplies public events, returns an unsubscribe function, and keeps session persistence internal on `message_end`.
- `[OK] typebox` — existing dependency; child requests continue to use the published parent-tool schemas.
- Existing `extensions/subagent/`, `extensions/tool-registry/`, and `extensions/tool-permissions/`; no new package.
- The product glossary artifact is absent; this story uses the established epic terms without inventing synonyms.

## 14. Failure modes
Unknown child ID, child failure before first event, stale completion callback after shutdown, event buffer overflow, and result request while running.

## 15. Observability
Expose child ID, status, cwd, elapsed time, safe event summaries, truncation, and terminal reason. Do not copy secret-bearing raw events into audit logs.

## 16. Impact
Changes `extensions/subagent/agent-session.ts` from invocation-scoped execution to parent-session-owned background lifecycle and adds callers for status/result retrieval. Existing permission routing and cleanup contracts must remain intact.

## 17. Acceptance criteria
### Scenario: Foreground remains available
**Given** a child task has been accepted
**When** the child continues running
**Then** launch returns a stable ID immediately and the parent can perform other work.

### Scenario: Explicit result retrieval
**Given** a child has completed
**When** the parent requests its result by ID
**Then** the complete bounded result is returned exactly once per request without having been injected automatically.

### Scenario: Completion awareness
**Given** a child reaches a terminal state
**When** the parent is active or idle
**Then** a minimal `subagent_finished` signal is queued for the parent's next natural turn and no turn is triggered automatically.

### Scenario: Safe shutdown
**Given** active children exist
**When** the parent session exits or reloads
**Then** every child is cancelled and disposed without persistence or orphan work.

### Scenario: Main and child prompt concurrency
**Given** a main-agent permission prompt is visible and a child permission request arrives, or the requests arrive in the reverse order
**When** the user decides the visible prompt
**Then** only that immutable request settles, the next request appears in FIFO order, and it requires an independent decision.

### Scenario: Child permission parity
**Given** a child requests a tool in its effective cwd
**When** the request matches an automatic in-project read/search rule, configured allow rule, configured deny rule, or `.aiignore`
**Then** the shared main-agent permission model produces the same allow, deny, or prompt outcome without a second evaluator.

### Scenario: Temporary child admission limit
**Given** one background child is active
**When** another child launch is requested before e06s06
**Then** the second launch is rejected while the temporary one-active-child limit remains in force.

## 18. Automated verification
- `node --test extensions/subagent/background-session.test.ts`
- `node --test extensions/subagent/background-events.test.ts`
- `node --test extensions/subagent/background-lifecycle.test.ts`
- `node --test extensions/subagent/agent-session.test.ts extensions/subagent/index.test.ts extensions/subagent/missing-ui.test.ts extensions/subagent/permission-boundary.test.ts extensions/subagent/working-directory.test.ts extensions/tool-permissions/permission-boundary.test.ts`
- `npm run check`

## 19. Implementation steps

For every behavior, first add the smallest compilable public stub, record a behavioral RED failure in its own Jujutsu change, then implement GREEN in a separate Jujutsu change. Missing modules, exports, imports, and functions are not acceptable RED evidence.

1. Define generated IDs, registry isolation, lifecycle states, immutable terminal transitions, and temporary single-active-child admission → verify: node --test extensions/subagent/background-session.test.ts
2. Normalize published assistant/tool events with monotonic sequence, deterministic count/UTF-8 byte bounds, explicit truncation, and late-event rejection → verify: node --test extensions/subagent/background-events.test.ts
3. Start the child only after lifecycle authority is installed, return without awaiting completion, and preserve the sole shared permission bridge → verify: node --test extensions/subagent/background-lifecycle.test.ts
4. Register `subagent_result`, return status while active, and return stable atomic terminal snapshots only through explicit retrieval → verify: node --test extensions/subagent/background-session.test.ts
5. Queue a fixed ID-plus-status `subagent_finished` message for the next natural turn without child-authored content or an automatic turn → verify: node --test extensions/subagent/background-lifecycle.test.ts
6. Close on abort and every session-shutdown reason by denying pending work, aborting children, unsubscribing, bounding cleanup, disposing, and rejecting stale callbacks → verify: node --test extensions/subagent/background-lifecycle.test.ts
7. Preserve schema validation, cwd-aware authorization, fail-closed prompting, exactly-once execution/audit, and absence of raw child events from logs or parent context → verify: node --test extensions/subagent/agent-session.test.ts extensions/subagent/index.test.ts extensions/subagent/missing-ui.test.ts extensions/subagent/permission-boundary.test.ts extensions/subagent/working-directory.test.ts extensions/tool-permissions/permission-boundary.test.ts && npm run check
8. Serialize main and child permission presentation through one parent-session-ID-keyed immutable-identity FIFO queue shared across extension module graphs, cancel/close exact waiters fail-closed, visibly attribute child prompts, and route child requests through the same cwd-aware automatic/configured allow and deny model as main requests → verify: node --test extensions/tool-permissions/prompt-queue.test.ts extensions/subagent/missing-ui.test.ts extensions/subagent/permission-boundary.test.ts

## 20. Definition of done
A child runs without blocking the foreground agent, exposes a bounded observable event stream, signals completion without triggering a turn, returns output only through explicit retrieval, and leaves no active work after shutdown.
