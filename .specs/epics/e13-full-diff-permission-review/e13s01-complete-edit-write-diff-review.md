# e13s01 — Review complete edit and write diffs before approval

## User need
When a permission prompt asks the user to approve an `edit` or `write`, the diff is the basis for the decision. Cropping it forces the user to approve a change they cannot fully see.

## Requirements
- MODIFIED: Permission review rendering for `edit` and `write` requests.
  - **Before:** the prompt crops the presented diff to a fixed number of lines.
  - **After:** the prompt presents every line of the pending change; the user accepts or denies based on the whole diff.
- Long diffs remain navigable (scrolling or equivalent) without truncating content.
- The rendered content the user approves is exactly the change that would be applied — no elided lines, no "N more lines" placeholders.

## Acceptance criteria
- An `edit` permission request with a diff longer than the previous crop limit shows all lines.
- A `write` permission request for a large new file shows all lines.
- Short diffs render unchanged (no regression in the common case).
- The user can still accept or deny from the same prompt after reviewing the full diff.

## Verification
- `node --test extensions/tool-permissions/diff-review.test.ts`
- `npm run check`
