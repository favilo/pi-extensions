# e11s02 — Return denied edit outcomes and reasons to the agent

## User need
When a user denies an edit, both the UI and the agent must see a denial rather than a false success.

## Requirements
- Return a canonical denied tool result to the agent, independently from successful and failed edit outcomes.
- Set the agent-facing status to `Denied`, not `Applied` or success.
- Include the user-provided denial reason in the agent-facing result when present.
- Derive the tool-history rendering from the same denied result so the UI cannot disagree with what the agent received.

## Acceptance criteria
- A denied edit without a reason returns `Denied` to the agent and renders `Denied`.
- A denied edit with steering text returns `Denied` plus the safe reason to the agent, and history reflects the same outcome.
- Successful edits retain their existing agent result and diff rendering.
- Tests assert both the agent-facing result and its rendering, not rendering alone.

## Verification
- `node --test extensions/built-in-tool-renderer/edit-result.test.ts`
- `npm run check`
