# e15s03 — Inject terminal completion into the agent queue

## User need
When a background Bash task finishes, the agent should be woken with a minimal completion notice so it does not poll or busy-wait with `bash_task`. Live line monitors remain a separate opt-in for occasional progress updates.

## Requirements
- ADDED: Every background Bash task emits exactly one completion message when it reaches a terminal state (completed, failed, cancelled, or timed-out), whether or not `monitor: true`.
- ADDED: The completion payload is minimal: task id, status, and exit code (plus signal when present). It must not include stdout or stderr lines.
- ADDED: Delivery uses the same agent-flow injection path as other background Bash custom messages: steer while the parent is active, and trigger a turn when the parent is idle. It must not interrupt an in-flight tool call, bypass normal message ordering, or synthesize a user message.
- ADDED: Completion messages use the distinct custom type `background_bash_complete` so they are not conflated with live `background_bash_monitor` output batches.
- ADDED: Tool descriptions for background Bash launch and `bash_task` tell the agent to wait for the completion message, then call `bash_task` for status or output — not to sleep-loop or repeatedly poll while the task runs.
- MODIFIED: The `monitor` parameter description and related tool copy clarify that monitoring is for occasional progress lines or small batches on long-running jobs, must not be used to stream high-volume output into context, remains subject to existing rate/byte/message caps, and is independent of terminal completion notification.
- ADDED: Monitored tasks keep live line deliveries; the always-on completion path replaces any separate monitor-only terminal summary so a task never double-fires two terminal messages.
- ADDED: On parent cancellation or session shutdown, completion delivery is disabled with the rest of the registry cleanup; no late callback can append a completion message or wake a replacement session.

## Non-goals
- Changing monitor line/batch delivery semantics beyond description clarification and terminal-summary dedupe.
- Automatically injecting command output on completion.
- Persisting completion subscriptions across reload or session replacement.
- Tying completion notification to `monitor: true`.

## Acceptance criteria
- Given a background Bash task with `monitor` omitted or false reaches a terminal state, the parent receives exactly one `background_bash_complete` message identifying task id, status, and exit code (and signal when present), with no output lines.
- Given a background Bash task with `monitor: true` reaches a terminal state, the parent still receives exactly one terminal completion message of type `background_bash_complete`, and does not also receive a second monitor-path terminal summary.
- Given the parent is active, the completion message joins the steering flow before the next model request; given it is idle, the message starts one new agent turn.
- Given tool descriptions for background launch, `monitor`, and `bash_task`, an agent reading them is instructed to await completion injection rather than poll or wait-loop, and to treat `monitor` as occasional progress-only injection.
- Given the session ends or the registry closes, no late completion callback delivers a message.

## Automated verification
- `node --test extensions/background-bash/lifecycle.test.ts`
- `node --test extensions/background-bash/monitor.test.ts`
- `node --test extensions/background-bash/permission-boundary.test.ts`
- `npm run check`

## Implementation notes
Create the smallest compilable stub that exposes the completion-notify contract before each RED test. RED must prove a behavioral contract failure, not a missing module or export; keep RED and GREEN in separate Jujutsu changes. Reuse the existing `pi.sendMessage(..., { deliverAs: "steer", triggerTurn: true })` delivery options. Prefer a single always-on terminal hook in the lifecycle registry; remove or no-op the monitor-only `onMonitorComplete` terminal send so monitored and unmonitored paths share one completion message.

## Definition of done
Every background Bash task wakes the parent once on completion with minimal status metadata, tool copy steers agents away from polling, and monitors remain a separate occasional-progress channel without duplicate terminal notices.
