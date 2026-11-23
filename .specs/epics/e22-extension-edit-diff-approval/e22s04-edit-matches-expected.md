# e22s04 — Built-in edit multi-match via matches_expected

> Outline only. Fill countable plan details via `plan-work` in a later session.

## 1. Identity

- **Story:** e22s04
- **Type:** feature
- **Maturity:** 2 — Outline
- **BCPs:** 3
- **Risk:** P0
- **Delta:** ADDED

## 2. User need

Agents often need to replace the same `oldText` in several places in one file.
Today preflight fails with "oldText matches more than once," forcing N separate
edits or unsafe workarounds. When the agent knows the exact match count, it
should be able to apply all replacements in one call.

## 3. Goal

- Extend each edit entry with optional `matches_expected: n` (positive integer).
- When `matches_expected` is set to `n`, apply the replacement to exactly `n`
  non-overlapping occurrences of `oldText` (or the documented match rule).
- If the actual occurrence count is not exactly `n`, fail closed with a clear
  reason (same class of truthful edit failure as e11) and do not open a
  permission prompt.
- When `matches_expected` is omitted, keep current behavior: zero matches →
  not found; more than one → duplicate failure.
- Diff/permission review (e22s01) must show the full multi-occurrence change
  when `matches_expected` is used.

## 4. Non-goals

- Regex or structural (ast-grep) multi-edit (see e14).
- Implicit "replace all" without an explicit expected count.
- Changing extension-registered edit tools beyond sharing the same edit-pair
  schema if they already reuse preflight.

## 5. Acceptance criteria (outline)

- Given a file with exactly `n` occurrences of `oldText` and
  `matches_expected: n`, the edit applies all `n` replacements and reports
  success.
- Given a count mismatch (fewer or more than `n`), the edit fails with an
  actionable reason and no permission prompt.
- Given `matches_expected` omitted, multi-match still fails as today.
- Permission/diff UI for an approved multi-match edit shows the complete
  contextual diff covering every replaced occurrence.
