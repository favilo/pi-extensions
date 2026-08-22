# e09s01 — Identify the exact tool invocation receiving steering feedback

## User need
When several tool calls are pending, steering entered from a permission prompt must identify the exact call it applies to so the agent cannot attach it to another parallel invocation.

## Requirements
- Bind steering feedback to a stable tool-call identity.
- MODIFIED: Invocation identification in the agent-facing steering message.
  - **Before:** (spec draft) include a safe, complete invocation summary (e.g. the full Bash command) in the steering message.
  - **After:** the allow-steer message carries the tool name and the pi `toolCallId` (`Steering for <tool> call <id>: <text>`) — cheap, exact, and resolvable by the agent through its own transcript. Inlining the subject was rejected: unbounded token cost.
- Deny-with-steering embeds the reason in the invocation-bound blocked result (via e11s02's `deniedResult`), which is protocol-bound to the toolCallId.
- Preserve the same identity in denial results and audit metadata.
- Prevent parallel prompts from sharing or overwriting steering context.

## Acceptance criteria
- Steering for one of two parallel tool calls binds only the selected call's toolCallId.
- The steer message contains no inlined invocation subject (command/path); the id is the binding.
- Denial and allow-with-steering paths preserve the same call identity.
- Sensitive inputs follow existing redaction rules.

## Verification
- `node --test extensions/tool-permissions/steering-context.test.ts`
- `npm run check`

## Human added:
Look into toolCallId, we could possibly use that to identify the exact tool
invocation without using a lot of tokens

## Progress note (2026-08-21, e11s02)
Deny+steer is now invocation-bound for free: the steering text is embedded in
the blocked tool result (`User denied <tool>. (reason: …)`), and a tool result
is protocol-bound to its toolCallId — no identity tokens spent. Remaining for
this story: allow-with-steering still travels as a floating steer message, and
steering text does not yet include a safe invocation summary.
