# e24s02 — Durable child pane and tab UI

> Outline only. Fill countable plan details via `plan-work` in a later session.

## 1. Identity

- **Story:** e24s02
- **Type:** feature
- **Maturity:** 2 — Outline
- **BCPs:** 5
- **Risk:** P1
- **Delta:** ADDED

## 2. User need

Users need a durable pane/tab UI: one tab per child, keyboard navigation, live status/output, and a clear title-bar badge when a child is waiting for permission.

## 3. Goal

Replace the current child display with that navigable UI. Permission prompts appear in the waiting child's tab/pane so the user has direct execution context.

## 4. Non-goals

- Parent-side serialization algorithm details beyond UI hooks (e24s03).

## 5. Acceptance criteria (outline)

- Each child has a durable tab/pane with live status and output.
- Keyboard navigation switches children.
- A waiting-for-permission child shows a title-bar badge and hosts its prompt in-pane.
