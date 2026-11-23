# e24s01 — Parallel child concurrency and lifecycle contracts

> Outline only. Fill countable plan details via `plan-work` in a later session.

## 1. Identity

- **Story:** e24s01
- **Type:** feature
- **Maturity:** 2 — Outline
- **BCPs:** 5
- **Risk:** P0
- **Delta:** ADDED

## 2. User need

Independent subagents should run in parallel. The old single-active-child limit blocks that.

## 3. Goal

Remove the single-active-child constraint and define concurrency semantics for simultaneous file edits, cancellation, completion notifications, background lifecycle cleanup, and result export. Preserve per-child runtime isolation and the requirement that every child tool action receives separate approval.

## 4. Non-goals

- Building the pane/tab UI (e24s02).
- Parent approval routing UI details (e24s03).

## 5. Acceptance criteria (outline)

- Two independent children can be active concurrently.
- Cancellation and cleanup are well-defined per child.
- Child tool actions still require separate approval.

## 17. Verification Script

1. Run focused subagent concurrency tests.
2. Run `npm run check`.
3. Launch independent child tasks and verify they remain isolated while their lifecycle results stay attributable.
