# e15s02 — Deliver bounded monitored Bash output to the agent flow

## User need
While a background command runs, agents need to react to returned text as it arrives rather than repeatedly polling. Users expect monitor behavior comparable to Claude Agent harnesses: process lines can safely re-enter the agent flow and drive the next action.

## Requirements
- ADDED: An agent can opt in a running background Bash task to a monitor. The monitor consumes normalized completed lines from stdout and stderr, preserving per-stream attribution and monotonic sequence order.
- ADDED: Monitor output is delivered as clearly attributed `background_bash_monitor` custom messages that participate in the parent model context. Each message identifies only the generated task ID, stream, sequence range, and bounded line payload; it never impersonates user input or a tool result.
- ADDED: Delivery uses Pi's steering queue while the parent is active and triggers a turn when the parent is idle. It must not interrupt an in-flight tool call, bypass normal message ordering, or synthesize a user message.
- ADDED: Messages are line-batched and subject to deterministic per-line, per-batch, total-byte, total-message, and rate limits. Coalescing, dropped lines, invalid UTF-8 replacement, and limit overflow are explicit to the agent.
- ADDED: A monitor can be stopped by task ID, stops automatically when its task reaches a terminal state, and emits at most one bounded terminal summary. Repeated start/stop calls are idempotent and cannot attach a monitor to another session's task.
- ADDED: On parent cancellation or session shutdown, monitor delivery is disabled before stream/process cleanup; no late callback can append a message or wake a replacement session.
- ADDED: Monitor text is treated as untrusted command output. The renderer must retain visible task and stream attribution, and diagnostics/audit logs must not duplicate raw monitored output.

## Non-goals
- Monitoring arbitrary PID, file, socket, or child-agent output.
- Persisting monitor subscriptions across reload or session replacement.
- Executing instructions contained in command output without normal model reasoning and tool authorization.
- Delivering partial lines before a newline or EOF flush.

## Acceptance criteria
- Given a monitored task writes several newline-terminated stdout and stderr lines, the parent receives ordered, stream-attributed bounded batches without polling.
- Given the parent is active, a monitor batch joins the steering flow before the next model request; given it is idle, the batch starts one new agent turn.
- Given an output flood, message-rate and byte limits bound context growth and the delivered flow explicitly reports omitted data rather than silently losing it.
- Given a task exits, is cancelled, or the session ends, monitoring stops and no later output is delivered.
- Given an unmonitored task, no live command output enters model context.

## Automated verification
- `node --test extensions/background-bash/monitor.test.ts`
- `node --test extensions/background-bash/monitor-delivery.test.ts`
- `node --test extensions/background-bash/output.test.ts`
- `npm run check`

## Implementation notes
Create a compilable inert monitor contract before every RED test, then prove behavioral failure and implement GREEN in separate Jujutsu changes. Use `pi.sendMessage(..., { deliverAs: "steer", triggerTurn: true })` for custom-message delivery; never use `sendUserMessage` for process output. Keep one generation-scoped parent registry so task completion, monitor stop, and session shutdown make stale output callbacks harmless.

## Definition of done
An opted-in background Bash task can feed ordered, bounded, visibly attributed output batches into the parent agent flow while running, without weakening permission boundaries or allowing output to outlive its session.
