# e11s02 — Return denied edit outcomes and reasons to the agent

## User need
When a user denies an edit, both the UI and the agent must see a denial rather than a false success.

## Requirements
- MODIFIED: Agent-facing result for a denied `edit` or `write`.
  - **Before:** the history renderer manufactured a presentation-only `Applied` for results whose text did not start with "Error", so denials displayed as success.
  - **After:** the denial returns a canonical failed tool result (`User denied <tool>.`) and the history renderer derives from that same agent-facing result via the `isError` flag.
- MODIFIED: Delivery of the user-provided denial reason (`Tab` steering text).
  - **Before:** the steering text was delivered as a floating steering message (`deliverAs: "steer"`), unbound from the invocation — parallel requests could misconsume it (the e09 ambiguity).
  - **After:** deny+steer embeds the reason in the invocation-bound blocked result: `User denied <tool>. (reason: <steering>)`. No separate steer message is sent for denials; allow+steer still steers via message because an allowed call's result comes from the tool itself. All denial paths (edit, write, bash, subagent, external path, custom tools) share one `deniedResult` helper.
- Successful edits retain their existing agent result and diff rendering.

## Acceptance criteria
- A denied edit without steering returns the canonical denial to the agent and history renders that same denial text — never `Applied`. (Verified live: agent receives `User denied write.`)
- A denied edit with steering text embeds the reason in the blocked result (`User denied edit. (reason: …)`), and history reflects the same denied outcome. (Verified live: first as a steer message, then re-verified as the embedded invocation-bound reason.)
- Successful edits retain their existing agent result and diff rendering.
- Tests assert both the agent-facing result and its rendering, not rendering alone.

## Verification
- `node --test extensions/tool-permissions/edit-denial.test.ts`
- `node --test extensions/built-in-tool-renderer/edit-result.test.ts`
- `npm run check`
