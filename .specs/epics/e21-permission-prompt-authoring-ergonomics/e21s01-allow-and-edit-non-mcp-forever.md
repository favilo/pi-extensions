# e21s01 — Allow and edit forever for known non-MCP tools

> Outline only. Fill countable plan details via `plan-work` in a later session.

## 1. Identity

- **Story:** e21s01
- **Type:** feature
- **Maturity:** 2 — Outline
- **BCPs:** 4
- **Risk:** P1
- **Delta:** ADDED

## 2. User need

When a known non-MCP tool (for example `context-checkpoint` or a skill tool) asks for permission, the user needs the same forever-save and pattern-edit shortcuts MCP tools already have: project vs user scope, with the current invocation parameters prefilled so they can tighten the rule.

## 3. Goal

For known tools that already evaluate under their own permission key:

- Expose **Ctrl+A** / **Ctrl+Shift+A** allow-and-save (project / user) even when `suggestedRule` is empty.
- Expose **Ctrl+E** / **Ctrl+Shift+E** edit-and-save (project / user) that opens the external editor with the **current call parameters** prefilled as an editable rule draft.
- The user may delete fields they do not care about; an empty object still means allow every call for that tool key.
- The temporary editor buffer includes a **comment block with examples** of how permission rules work.
- Update the other permission-edit templates (pattern editor and `/permissions` file editor headers) to use the same example-comment style.

## 4. Non-goals

- Changing MCP forever-save behavior beyond shared template comments.
- The propose-rule tool (e21s03).
- Compressing the prompt chrome (e21s02).

## 5. Requirements (outline)

### ADDED: Forever-save for known non-MCP tools

Known non-MCP permission prompts offer Ctrl+A / Ctrl+Shift+A with an empty or parameter-derived rule under the tool's own key, matching MCP empty-rule forever allow.

### ADDED: Ctrl+E / Ctrl+Shift+E parameter-prefilled edit

- Ctrl+E edits and saves to project `.pi/permissions.toml`.
- Ctrl+Shift+E edits and saves to the user permissions file.
- Prefill from the current invocation parameters; user may trim fields.

### MODIFIED: Permission edit templates

Temp-file and permissions-editor buffers carry a shared comment explaining rule shape, empty-object forever allow, RegExp field matching, and short examples.

## 6. Acceptance criteria (outline)

- A known non-MCP tool prompt shows Ctrl+A, Ctrl+Shift+A, Ctrl+E, and Ctrl+Shift+E when forever actions are available.
- Ctrl+E / Ctrl+Shift+E open an editor whose JSON starts from current parameters and whose header comments document permission rule examples.
- Saving persists to the matching project or user scope and allows the current call only after persistence succeeds.
- Pattern-edit and permissions-file edit templates include the same class of example comments.

## 7. Prior art / related

- e03s02 scoped Ctrl+A / Ctrl+Shift+A save
- `editPatternInExternalEditor` / `editPermissionsInExternalEditor` in `extensions/tool-permissions/index.ts`
- Known MCP empty `suggestedRule` forever allow path
