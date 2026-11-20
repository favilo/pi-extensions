# e22s02 — Settings-registered extension edit tools with diff approval

> Outline only. Fill countable plan details via `plan-work` in a later session.

## 1. Identity

- **Story:** e22s02
- **Type:** feature
- **Maturity:** 2 — Outline
- **BCPs:** 4
- **Risk:** P0
- **Delta:** ADDED

## 2. User need

Extension tools that perform exact-text edits should opt into the same diff-based approval UI as Pi's built-in `edit` tool, without hard-coding tool names in tool-permissions.

## 3. Goal

- Register eligible extension edit tools from a **JSON settings file under `~/.pi/agent/`** (not hard-coded names).
- Each configured tool resolves a request into: stable display path, existing text, and `edits[].oldText` / `edits[].newText`.
- The permission prompt generates and displays the complete contextual diff before approval, then preserves the existing tool execution path.
- Reject an invalid resolver result or an edit whose preconditions fail **before** prompting.
- Keep policy/registration semantics suitable for the Rust/WASM permission boundary; leave host-specific filesystem resolution in the host adapter.

## 4. Non-goals

- Implementing the `obsidian_edit` consumer wiring (e22s03).
- Changing built-in `edit`/`write` full-diff behavior beyond e22s01.

## 5. Acceptance criteria (outline)

- A tool listed in the `~/.pi/agent/` JSON settings participates in diff approval.
- An unlisted extension edit tool does not use that path.
- Invalid resolver output or failed edit preconditions never reach the approval prompt.
- Approved calls still execute through the original tool path.
