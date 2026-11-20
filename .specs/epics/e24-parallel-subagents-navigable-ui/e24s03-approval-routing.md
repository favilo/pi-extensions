# e24s03 — Parent approval serialization and result routing

> Outline only. Fill countable plan details via `plan-work` in a later session.

## 1. Identity

- **Story:** e24s03
- **Type:** feature
- **Maturity:** 2 — Outline
- **BCPs:** 3
- **Risk:** P0
- **Delta:** ADDED

## 2. User need

With multiple children waiting, the parent must serialize or otherwise safely coordinate approval decisions, route each result to the correct child, and prevent ambiguous prompts.

## 3. Goal

Define and implement parent-side approval coordination so simultaneous child prompts cannot be confused, and each decision returns only to the requesting child.

## 4. Acceptance criteria (outline)

- Concurrent child permission asks never share an ambiguous prompt identity.
- Each allow/deny/steer result routes to the correct child only.
- Parent coordination preserves per-child approval requirements from e24s01.
