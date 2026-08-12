# Threat Model — e06 Permission-enforced observable background subagents

## Scope

This threat model covers the existing permission-enforced child runtime and the e06s05–e06s06 increment: parent-session-owned background execution, normalized `AgentSessionEvent` buffering, explicit status/result retrieval, minimal completion signals, switchable read-only transcript panels, and main-window permission prompts.

In scope:

- Constructing, subscribing to, cancelling, and disposing child `AgentSession` instances.
- Parent-owned task IDs, state transitions, event buffers, results, and completion notifications.
- Child working-directory and permission-policy resolution.
- Child tool-call interception through the existing `tool-permissions` boundary.
- Concurrent children, serialized permission prompts, panel identity, focus, and shutdown/reload behavior.

Out of scope:

- Interactive steering from child panels.
- Resuming active children after process exit or reload.
- External transcript-analysis APIs.
- Private provider reasoning not published by Pi.
- Bash subcommand parsing (e07).

## Assets and trust boundaries

| Asset | Boundary / concern |
|---|---|
| User files, repositories, and credentials | A background child remains untrusted model output; every capability request must cross the same scoped permission boundary as foreground work. |
| User approval | A decision for one main-agent or child tool request must never authorize another queued request or actor. |
| Parent foreground session | Child completion and event streaming must not mutate parent model context unexpectedly, trigger unsolicited turns, or make the foreground unusable. |
| Child task registry | IDs, state, cancellation controllers, buffers, and results must remain scoped to one live parent extension instance. |
| Child transcript | Assistant text, tool arguments, tool results, paths, and permission details may contain secrets and must not leak into audit/debug logs or unrelated sessions. |
| UI identity and focus | The visible child, requesting child, and permission decision recipient must remain unambiguous during concurrent updates and panel switches. |
| Child session storage | Pi may persist child messages through a file-backed `SessionManager`; event buffering must not silently create a second durable secret-bearing store. |

## Abuse cases and required mitigations

### Authorization bypass in detached execution — HIGH — CWE-863 / CWE-284

Returning from the launch tool before child completion could detach the child from the invocation-scoped boundary, signal, cwd, or parent context. A background child might then execute after the authorizing session has ended or use a direct SDK/process path.

**Required mitigation:** Keep the existing single `tool-permissions` bridge as the child's only tool surface. Build the boundary, validated tool catalog, effective cwd, and parent-owned cancellation controller before launch returns. Never retain an invocation signal or stale `ExtensionContext` as the background lifecycle authority. Reject requests after registry shutdown and prove no direct SDK, process, shell, or MCP path bypasses the bridge.

### Permission decision cross-wiring — HIGH — CWE-362 / CWE-863

Main-agent and child requests can overlap while focus changes. Overlapping dialogs or an unkeyed resolver may deliver one user's decision to multiple requests or to the wrong actor; limiting child concurrency does not prevent this main-versus-child race.

**Required mitigation:** Assign immutable request IDs bound to actor identity, tool name, safe input identity, and cwd. Present every main and child permission dialog through one FIFO parent-session-owned queue and resolve only the matching waiter. Active or queued cancellation resolves that exact request fail-closed; prompt errors and shutdown deny/cancel every still-pending request exactly once. Keep the temporary one-active-child admission limit until e06s06 separately expands child concurrency.

### Missing UI or hidden permission prompt — HIGH — CWE-754 / CWE-863

A background child may request permission while no TUI exists, another custom component owns focus, or a child panel obscures the parent. Treating prompt failure as approval would bypass policy.

**Required mitigation:** Preserve current fail-closed behavior: only explicit allow rules execute without UI; every unmatched request denies when the prompt cannot be displayed. Child panels must yield to the existing main-window permission UI and visibly identify the requesting child. Prompt presentation failure, cancellation, or shutdown denies the request.

### Orphan child or stale callback after shutdown — HIGH — CWE-672 / CWE-404

A launch tool can return while promises, model streams, tool calls, event listeners, and completion callbacks remain active. Reload may create a new extension instance while stale callbacks write into old or new state.

**Required mitigation:** Own children under a session-scoped registry with an idempotent closing state. On abort, reload, new/resume/fork, or shutdown: reject new work, deny pending permissions, abort every child, unsubscribe listeners, await or bound cleanup, dispose sessions, then discard registry state. Completion callbacks capture a generation token and become no-ops after closure.

### Completion-signal prompt injection or unsolicited execution — HIGH — CWE-74

A model-authored child name or output embedded in `subagent_finished` could inject instructions into parent context. Completion intentionally steers active work or starts an idle parent turn, so any child-authored content in the signal could cause unexpected tools to run.

**Required mitigation:** Use generated or strictly validated child IDs and a fixed structured signal containing only ID plus enumerated terminal status. Never include child output, errors, tool text, or user-provided names in the context signal. Deliver the fixed signal through the steering queue and trigger an idle parent turn. Retain it only until the main message stream acknowledges the exact ID, status, and fixed content; retry after parent settlement when late steering was not consumed, and clear pending delivery during session shutdown. Full output remains behind explicit result retrieval.

### Cross-session or cross-child result disclosure — HIGH — CWE-639

Guessable IDs or global registries could let a model retrieve another parent session's child transcript/result, including secret-bearing tool output.

**Required mitigation:** Scope lookups to the current parent registry and use collision-resistant generated IDs independent of display names. Status/result APIs return a generic unknown-ID result outside that registry. Never search arbitrary session files or accept filesystem paths as child IDs. Clear access on session replacement.

### Event-order and terminal-state race — MEDIUM — CWE-362

Streaming events can arrive while cancellation, completion, truncation, result retrieval, or panel disposal occurs. Late events could change a terminal state, appear under another child, or produce incomplete authoritative results.

**Required mitigation:** Serialize state transitions per child, allow one immutable terminal transition, tag every normalized event with child ID and monotonic sequence, unsubscribe before disposal, and ignore late events after terminal sealing. Snapshot status/results atomically for retrieval and rendering.

### Transcript and diagnostic secret leakage — MEDIUM — CWE-532

Child assistant text, tool inputs/results, environment values, permission details, and errors may contain credentials or private content. Buffering, debug logs, audit records, completion signals, and future external analysis multiply exposure.

**Required mitigation:** Keep the MVP event buffer session-scoped and bounded. Do not copy raw events into permission audit/debug logs, parent context, completion signals, or custom persistent entries. Mark truncation explicitly. If Pi's child `SessionManager` persists messages, document that single store and its path/lifetime; do not add another durable transcript store until a separate retention, access, and redaction design is approved.

### Memory, model, and rendering exhaustion — MEDIUM — CWE-400

A model can emit unbounded text/tool updates or launch many children, consuming provider quota, memory, CPU, and terminal rendering time after the foreground tool already returned.

**Required mitigation:** Set limits for active children, queued launches, event count, UTF-8 bytes, individual event size, completed-result retention, and cleanup time. Coalesce high-frequency partial updates, truncate deterministically, and render only the visible panel viewport. Surface limit failures as terminal child states.

### UI spoofing, attribution loss, or focus capture — MEDIUM — CWE-451

ANSI/control characters or ambiguous names could make child output resemble parent prompts, hide status, or capture keys. A panel could retain focus after closure and prevent foreground control.

**Required mitigation:** Sanitize display strings and use generated IDs plus clearly themed, fixed headers. Never render child content as trusted UI chrome. Use Pi/TUI width-safe components and explicit overlay focus handles. `Escape`, panel completion, disposal, and shortcut cycling must restore the prior editor deterministically. Do not override an existing `Ctrl+Tab` registration silently.

### Cancellation/result ambiguity — MEDIUM — CWE-754

A cancelled or failed child could expose partial output as a successful result, or retrieval while running could fabricate completion.

**Required mitigation:** Return structured enumerated status separately from optional bounded output. Retrieval before a terminal state reports current status only. Failure and cancellation remain distinct; neither is represented as completed. Repeated retrieval is read-only and stable.

## Security review result

The implemented e06s05 runtime keeps child execution behind `tool-permissions`, validates published schemas, constrains cwd, and owns cleanup under the parent session. Manual UAT exposed a main-versus-child prompt displacement that orphaned the child's prompt promise. The repair routes every main and child prompt through one session-owned FIFO queue, hashes rather than retains raw input identity, makes settlement idempotent, propagates active cancellation, closes pending work on session shutdown, and applies the shared normalized cwd-aware resolver to child requests. Focused tests cover both arrival orders, independent decisions, queued and active cancellation, prompt errors, shutdown, late results, `.aiignore`, and configured allow/deny precedence. No raw input was added to queue identity, audit output, or completion messages.

**Verdict:** PASS with no unresolved HIGH-confidence finding in the changed permission paths. Live TUI reverification remains mandatory because unit tests cannot prove Pi's concrete focus restoration behavior. The temporary one-active-child admission limit remains until e06s06 separately expands child concurrency.

## Verification obligations

- Prove launch returns before child completion while the foreground remains usable.
- Prove every background tool request still crosses schema validation, cwd-aware policy evaluation, permission prompting, execution, and audit exactly once.
- Prove e06s05 rejects a second prompt-capable active child until keyed prompt serialization exists.
- Prove request IDs prevent concurrent permission decisions from crossing main/child actor identity, tool, cwd, or safe input identity in both arrival orders.
- Prove child requests receive the same cwd-aware automatic allow, configured allow, configured deny, and `.aiignore` outcomes as equivalent main requests.
- Prove missing/hidden UI, prompt cancellation, queue cancellation, and shutdown all deny rather than allow.
- Prove reload, session replacement, abort, and exit unsubscribe and dispose every child with no late state mutation.
- Prove generated child IDs cannot retrieve another parent registry's status, events, or result.
- Prove `subagent_finished` contains only generated ID and enumerated status, steers active work or triggers an idle parent turn, retries only while exact delivery remains unacknowledged, and is suppressed during session shutdown.
- Prove ordered bounded buffers, truncation, terminal sealing, stable repeated retrieval, and late-event rejection.
- Prove raw child events are absent from audit/debug logs, completion signals, and parent context before explicit retrieval.
- Prove transcript content is sanitized, width-bounded, viewport-limited, and cannot imitate trusted panel headers.
- Prove `Ctrl+Tab`, `Escape`, child completion, prompt display, and panel disposal restore the correct focus without swallowing permission input.
