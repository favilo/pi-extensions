# e20s02 — Persistent opt-in current-provider quota footer

## 1. Identity

- **Story:** e20s02
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 2
- **Risk:** P1
- **Delta:** ADDED

## 2. User need

A Pi user wants a footer bar that shows remaining quota for the **currently running** model/provider without leaving the session, without enabling it for every session by default, and without losing that preference across reloads.

## 3. Goal

Add a persistent opt-in footer via `ctx.ui.setFooter` that shows the current provider’s quota windows (both **5h** and **7d** when present), model id, and useful session hints. Default off. Toggle command persists the preference.

## 4. Non-goals

- Enabling the footer by default.
- Showing every configured account/subscription (multi-pass omarchy multi-account bar).
- Depending on `pi-multi-pass`.
- Replacing `jj-status` or other extensions’ `setStatus` text; those must remain visible.

## 5. Prior art

| Candidate | Source | Verdict | Notes |
|-----------|--------|---------|-------|
| multi-pass status bar | `createStatusBarComponent` / `applyStatusBar` in pi-multi-pass | extend | Reuse refresh/backoff and setFooter pattern; scope to current provider; show 5h and 7d. |
| Pi `custom-footer.ts` | `@earendil-works/pi-coding-agent` examples | compose | Canonical `setFooter` + `footerData` API. |

## 6. Requirements

### ADDED: Opt-in toggle with persistence

- Register a command (for example `/usage-footer`) that toggles the custom footer.
- Default: **off**.
- Persist the enabled flag under the agent config directory (for example `~/.pi/agent/usage.json` or an agreed usage settings file) so `/reload` and new sessions restore the choice.
- On extension load, if the persisted flag is true and UI is available, apply the footer; otherwise leave Pi’s default footer.

### ADDED: Current-provider footer content

When enabled, the footer shall show at least:

- Current provider short label / glyph
- **Both** 5h and 7d remaining percentages when the active checker returns those windows (for example `5h 62% · 7d 81%`)
- Current model id (for `pi-virtual` / auto, prefer the last successful physical model when available)
- Optional dim session hints already available without new deps: cwd short path, context %, git branch, clock

If only one window exists, show that window; if none yet, show a loading or unknown glyph without inventing percentages.

### ADDED: Refresh and failure behavior

- Poll quota on an interval comparable to multi-pass (about 5 minutes) with a bounded request timeout.
- Back off after total failures; keep the last good quota on transient per-check errors.
- Never render credentials or raw provider error bodies in the footer.

### ADDED: Coexistence with extension statuses

Replacing the footer must still render texts from `footerData.getExtensionStatuses()` so other extensions (for example `jj-status`) remain visible.

### RETAINED: Shared checkers

The footer consumes the same quota/usage adapters introduced in e20s01 (and later e20s03). It does not reimplement provider HTTP.

## 7. Acceptance criteria

### Scenario: Default off

**Given** a fresh install with no usage footer preference
**When** Pi starts
**Then** the default Pi footer remains and no quota footer is applied.

### Scenario: Toggle persists

**Given** the user enables the footer with the toggle command
**When** Pi reloads or starts a new session
**Then** the footer is applied again without requiring another toggle.

### Scenario: Shows 5h and 7d for Codex

**Given** the footer is enabled and the current provider is Codex with both windows available
**When** the footer renders
**Then** both 5h and 7d remaining percentages appear.

### Scenario: Current provider only

**Given** multiple accounts exist in account-switcher
**When** the footer renders
**Then** it reflects only the currently active provider/model, not a multi-account strip.

### Scenario: Extension statuses survive

**Given** another extension has published `setStatus` text
**When** the usage footer is enabled
**Then** that status text remains visible in addition to the quota line.

### Scenario: Disable restores default

**Given** the footer is enabled
**When** the user toggles it off
**Then** `setFooter(undefined)` restores the built-in footer and the persisted flag is false.

## 8. Automated verification

- `node --test extensions/usage/`
- `npm run check`

## 9. Definition of done

A persistent opt-in `/usage-footer` (or equivalent) command controls a current-provider quota footer that shows both 5h and 7d when available, preserves other extension statuses, never leaks credentials, and restores correctly across sessions.
