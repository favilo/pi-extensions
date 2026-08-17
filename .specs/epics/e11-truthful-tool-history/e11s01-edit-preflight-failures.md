# e11s01 — Return deterministic edit failures to the agent before permission prompts

## User need
When an edit cannot apply because `oldText` is absent, matches more than once, or overlaps another replacement, the agent needs an explicit failure and enough detail to retry safely.

## Requirements
- Validate deterministic edit preconditions before requesting write permission.
- Do not show a permission dialog when validation already proves the edit cannot execute.
- Return a canonical failed tool result to the agent with status `Failed` and the exact validation reason.
- Preserve the path and mismatch context needed for the agent to reread the file and retry.
- Derive the UI rendering from that same agent-facing result; do not patch presentation while leaving the agent result successful.
- Never report or render a failed edit as `Applied`.

## Acceptance criteria
- A missing `oldText` fails without opening a permission prompt.
- A non-unique `oldText` fails without opening a permission prompt.
- Overlapping replacements fail without opening a permission prompt.
- The agent-facing tool result identifies the failed precondition and supports a reread-and-retry flow; the history renderer reflects that result.

## Verification
- `node --test extensions/built-in-tool-renderer/edit-result.test.ts`
- `npm run check`
