# e21s04 — Skip redundant activate_skill when skill is unchanged

> Outline only. Fill countable plan details via `plan-work` in a later session.

## 1. Identity

- **Story:** e21s04
- **Type:** feature
- **Maturity:** 2 — Outline
- **BCPs:** 3
- **Risk:** P1
- **Delta:** ADDED

## 2. User need

Agents repeatedly call `activate_skill` for skills already loaded in the session. That fills context with duplicate `SKILL.md` content. When the skill files have not changed since the last load (including a recent `/skill:<name>` slash command), the call should short-circuit with a clear message instead of re-injecting the skill.

## 3. Goal

- For **every** `activate_skill` tool call, if that skill is already in context and its files are unchanged since the last load, skip reloading and return a message like: `It's already in context, and the skill hasn't changed since then`.
- If skill files changed since the last load, reload as today.
- Run this filter **before** `tool-permissions` evaluation for the reload path's cost, but **do not bypass any permission prompt** that would otherwise apply to `activate_skill`.

## 4. Non-goals

- Changing skill file formats.
- Blocking first-time loads or loads after file changes.
- YOLO / allow-rule bypass of activate_skill permissions.

## 5. Requirements (outline)

### ADDED: Session skill-load fingerprint

Track which skills are already in context and a fingerprint (or mtime/hash set) of their loaded files, including loads from `/skill:<name>`.

### ADDED: Pre-permissions redundant-load filter

Before the expensive reload, detect unchanged already-loaded skills and return the skip message. Permission prompting for `activate_skill` must still occur whenever the permission boundary would require it; the filter must not be an authorization bypass.

## 6. Acceptance criteria (outline)

- Second `activate_skill` for an unchanged already-loaded skill returns the skip message and does not re-inject `SKILL.md`.
- After a skill file change, `activate_skill` reloads.
- `/skill:<name>` followed by `activate_skill` for the same unchanged skill skips.
- Permission prompts for `activate_skill` are not skipped by this filter.
