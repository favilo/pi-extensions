# e09s01 — Identify the exact tool invocation receiving steering feedback

## User need
When several tool calls are pending, steering entered from a permission prompt must identify the exact call it applies to so the agent cannot attach it to another parallel invocation.

## Requirements
- Bind steering feedback to a stable tool-call identity.
- Include the tool name and a safe, complete invocation summary in the agent-facing steering message.
- For Bash, include the actual command associated with the prompt.
- Preserve the same identity and summary in denial results and audit metadata.
- Prevent parallel prompts from sharing or overwriting steering context.

## Acceptance criteria
- Steering for one of two parallel tool calls names only the selected call and its invocation.
- Bash steering contains the exact command from that permission prompt.
- Denial and allow-with-steering paths preserve the same call identity.
- Sensitive inputs follow existing redaction rules.

## Verification
- `node --test extensions/tool-permissions/steering-context.test.ts`
- `npm run check`

## Human added:
Look into toolCallId, we could possibly use that to identify the exact tool
invocation without using a lot of tokens
