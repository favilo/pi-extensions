# e22s03 — Wire obsidian_edit as the first registered consumer

> Outline only. Fill countable plan details via `plan-work` in a later session.

## 1. Identity

- **Story:** e22s03
- **Type:** feature
- **Maturity:** 2 — Outline
- **BCPs:** 2
- **Risk:** P1
- **Delta:** ADDED

## 2. User need

`obsidian_edit` should go through the same complete diff approval path as built-in edits, resolving `vault` + `note` to the vault note path via the settings-registered mechanism.

## 3. Goal

Register `obsidian_edit` in the `~/.pi/agent/` JSON settings (or ship a documented default entry) with a resolver from `vault`/`note` arguments to the note path, existing text, and edits array. Keep the mechanism generic for later extension edit tools.

## 4. Non-goals

- Reworking Obsidian vault discovery beyond what the resolver needs.
- Hard-coding `obsidian_edit` inside tool-permissions outside the settings file.

## 5. Acceptance criteria (outline)

- An `obsidian_edit` permission prompt shows the complete contextual diff for the target note.
- Bad vault/note resolution fails closed before the prompt.
- Other unregistered tools are unaffected.
