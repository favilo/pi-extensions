# e11s04 — Show tool-call reasons in permission prompts and history

## User need
When an agent requests a tool — especially `edit` or `bash` — the user approves or denies based on *why* the agent wants it. Today the reason lives only in the agent's prose, separated from the prompt where the decision happens.

## Requirements
- MODIFIED: Permission prompt rendering for tool requests.
  - **Before:** the prompt shows the command or diff without the agent's reason for requesting it.
  - **After:** when a tool call carries a reason, the prompt displays it alongside the command or diff before the user decides.
- MODIFIED: History rendering for tool calls.
  - **Before:** history shows the tool call and its result without the agent's reason.
  - **After:** history displays the same agent-facing reason alongside the call.
- ADDED: A reason channel on tool calls. If the tool-call protocol has no caller-supplied reason field, tools gain an optional `reason` parameter that the agent fills in and that flows to both the permission prompt and the history renderer.
- A call without a reason renders exactly as today — no empty placeholders.

## Acceptance criteria
- An `edit` or `bash` request carrying a reason shows it in the permission prompt before accept/deny.
- The history entry for that call shows the same reason.
- Calls without a reason render unchanged in both the prompt and history.
- The reason shown in history is the same agent-facing value shown at decision time, not a presentation-only reconstruction.

## Discovery notes (2026-08-21)
- No reason channel exists for tool calls today: the `tool_call` extension event carries only `{ toolName, toolCallId, input }`.
- Pi core *does* have the assistant message at decision time — `beforeToolCall` receives `{ assistantMessage, toolCall, args, context }` in the agent loop — but the extension runner drops it when emitting `tool_call`. Extending that event (or a schema-level `reason` parameter) are the two candidate channels.
- Deny+steer (e11s02) solved the user→agent direction by embedding the reason in the invocation-bound blocked result; the agent→user direction has no equivalent.
- Chosen channel (2026-08-21): an optional `reason` parameter injected into built-in tool schemas by the extension layer (built-in-tool-renderer already re-registers those tools). Tool-call arguments are protocol-bound to the toolCallId, so no identity plumbing is needed. The wrapper strips `reason` before delegating to the original execute; the permission prompt and history renderer read it from the call args. No pi-core change required.

## Verification
- `node --test extensions/tool-permissions/reason-display.test.ts`
- `node --test extensions/built-in-tool-renderer/result.test.ts`
- `npm run check`
