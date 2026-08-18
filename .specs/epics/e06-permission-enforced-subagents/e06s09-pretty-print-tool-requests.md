# e06s09 — Pretty-print subagent-tool-request tool calls and multiline bash commands

## 1. Identity
- **Story:** e06s09
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 3
- **Risk:** P1
- **Delta:** ADDED

## 2. User need
Users need `subagent-tool-request` calls in the prompt history and permission UI to be clean and readable, especially for multiline bash commands where escaped `\n` characters obscure the command structure.

## 3. Goal
Custom render `subagent-tool-request` tool calls and results so multiline bash commands are formatted with real line breaks and tool input objects are pretty-printed cleanly without escaped `\n` sequences.

## 4. Non-goals
- Modifying underlying tool execution or permission boundary logic.
- Bypassing terminal width bounds.

## 5. Requirements
- Implement `renderCall` for `subagent-tool-request` in the child permission bridge.
- Format `bash` tool call requests specially: display actual newlines and command structure instead of escaped `\n` strings in JSON.
- Format other tool requests (`read`, `write`, `edit`, etc.) with pretty-printed, syntax-highlighted argument keys and values.
- Ensure all rendered lines are bounded by the terminal width without overflow.

## 6. Failure modes
Multiline string overflow, missing toolName, raw JSON escaping fallback failure, unhandled tool input structure, and terminal width overflow.

## 7. Preconditions
- `subagent-tool-request` is the bridge tool surface for child agents.

## 8. Inputs
Tool request parameters `{ toolName, input }`, terminal width, theme.

## 9. Outputs
Formatted TUI representation of `subagent-tool-request`.

## 10. Quality attributes
Readability, width safety, clean line breaks, and clear tool attribution.

## 11. Interfaces and contracts
- Custom `renderCall` for `subagent-tool-request` tool definitions.
- Bounded line rendering with `wrapTextWithAnsi` per terminal width.

## 12. State
UI presentation formatting only; ephemeral per rendering turn.

## 13. Dependencies
- `@earendil-works/pi-tui` and `@earendil-works/pi-coding-agent`.

## 14. Failure modes
Unparseable input, multi-line wrapping overflow, and missing theme methods.

## 15. Observability
Expose formatted tool name, command/path arguments, and pretty-printed payload.

## 16. Impact
Improves `subagent-tool-request` TUI rendering in `extensions/subagent/index.ts`.

## 17. Acceptance criteria
### Scenario: Multiline bash command request
**Given** a subagent requests a multiline bash command containing `\n`
**When** the `subagent-tool-request` call is rendered in TUI
**Then** the command is displayed with actual line breaks and syntax styling instead of literal `\n` strings.

### Scenario: Formatted tool input
**Given** a subagent requests a file tool (e.g. `read`, `write`, `edit`)
**When** the call is rendered
**Then** the target path and arguments are formatted cleanly per line.

## 18. Automated verification
- `node --test extensions/subagent/tool-request-renderer.test.ts`
- `npm run check`
