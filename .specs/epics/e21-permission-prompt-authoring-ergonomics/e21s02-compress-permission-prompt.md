# e21s02 — Compress the permission prompt UI

> Outline only. Fill countable plan details via `plan-work` in a later session.

## 1. Identity

- **Story:** e21s02
- **Type:** feature
- **Maturity:** 2 — Outline
- **BCPs:** 2
- **Risk:** P2
- **Delta:** ADDED

## 2. User need

The permission prompt is too verbose and burns vertical space, so the decision and request scroll out of view.

## 3. Goal

Compress the prompt layout and drop redundant fields so more of the decision and request stay visible without scrolling. Preserve accept/deny/steer/save shortcuts and full request body when the user needs it.

## 4. Non-goals

- Changing authorization semantics.
- Replacing the full-diff review work owned by e22.

## 5. Acceptance criteria (outline)

- Redundant chrome/fields are removed or collapsed.
- Primary decision controls and the request subject remain visible in a typical terminal height without scrolling past the decision line.
- Existing keyboard shortcuts continue to work.

## 17. Verification Script

1. Run focused permission-prompt rendering and keyboard tests.
2. Run `npm run check`.
3. Open a representative prompt in a typical terminal and verify decision controls stay visible without changing shortcut behavior.
