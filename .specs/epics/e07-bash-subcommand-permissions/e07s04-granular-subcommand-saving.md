# e07s04 — Interactive subcommand selection and granular pattern saving

## 1. Identity
- **Story:** e07s04
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 3
- **Risk:** P1
- **Delta:** ADDED

## 2. User need
When a compound command contains multiple subcommands (e.g., `jj status && cargo test`), users need a keybinding in the permission prompt dialog to inspect individual subcommands and save allow rules for specific subcommands rather than allowlisting the entire raw string.

## 3. Goal
Add interactive subcommand selection mode to permission prompts. When a command contains multiple subcommands, pressing a dedicated keybinding (e.g., `s` or `Ctrl+S`) allows the user to pick specific subcommands to save as allow rules to `permissions.toml`.

## 4. Non-goals
- Auto-executing a partial command when only some subcommands are approved.
- Overriding explicit deny rules.

## 5. Requirements
- Expose parsed subcommands in the permission prompt UI state.
- Bind a key shortcut (e.g., `Ctrl+S`) in the permission prompt for subcommand rule saving.
- Allow selecting individual subcommands and saving exact allow patterns (`command = "^<subcommand>$"`) to project or user policy.
- Retain atomic command execution semantics: all subcommands must be authorized before the complete command runs.

## 17. Acceptance criteria
### Scenario: Subcommand saving keybinding
**Given** a permission prompt for `jj status && cargo test`
**When** the user presses the subcommand save keybinding (`Ctrl+S`)
**Then** the prompt displays the list of subcommands (`jj status`, `cargo test`) to select and persist as individual allow rules.

## 18. Automated verification
- `node --test extensions/tool-permissions/bash-subcommands.test.ts`
- `npm run check`
