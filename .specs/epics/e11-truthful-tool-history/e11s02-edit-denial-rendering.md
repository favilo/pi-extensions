# e11s02 — Return denied edit outcomes and reasons to the agent

## User need
When a user denies an edit, both the UI and the agent must see a denial rather than a false success.

## Requirements
- MODIFIED: Agent-facing result for a denied `edit` or `write`.
  - **Before:** the history renderer manufactured a presentation-only `Applied` for results whose text did not start with "Error", so denials displayed as success.
  - **After:** the denial returns a canonical failed tool result (`User denied <tool>.`) and the history renderer derives from that same agent-facing result via the `isError` flag.
- MODIFIED: Delivery of the user-provided denial reason (`Tab` steering text).
  - **Before:** (spec draft) embed the reason in the tool result.
  - **After:** the steering text is delivered to the agent as a separate steering message (`deliverAs: "steer"`); the tool result stays the canonical `User denied <tool>.` — the user prefers this split.
- Successful edits retain their existing agent result and diff rendering.

## Acceptance criteria
- A denied edit without steering returns the canonical denial to the agent and history renders that same denial text — never `Applied`. (Verified live: agent receives `User denied write.`)
- A denied edit with steering text delivers the text to the agent as a steering message, and history reflects the same denied outcome. (Verified live: steering text arrived as a readable steer message.)
- Successful edits retain their existing agent result and diff rendering.
- Tests assert both the agent-facing result and its rendering, not rendering alone.

## Verification
- `node --test extensions/tool-permissions/edit-denial.test.ts`
- `node --test extensions/built-in-tool-renderer/edit-result.test.ts`
- `npm run check`
