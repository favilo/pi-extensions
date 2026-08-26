# Spike: Pi Prompt Editor Integration for Permission Steering (e10s01)

## Executive Summary

Permission steering currently relies on a lightweight, manual single-line input handler in `extensions/tool-permissions/index.ts`. While effective for trivial text input, it lacks cursor movement, text editing utilities, IME support, and modal Vim input capabilities.

This spike evaluates the installed `@earendil-works/pi-tui` and `@earendil-works/pi-coding-agent` APIs to identify the supported boundary for embedding prompt editor behavior and configured Vim mode inside permission prompt steering.

---

## TUI Editor APIs & Ownership Boundaries

### Exposed Components & Interfaces

1. **`@earendil-works/pi-tui`**:
   - `Editor`: Multi-line and single-line text editor with buffer management, word wrapping, horizontal/vertical scrolling, cursor positioning, and `Focusable` IME cursor markers (`CURSOR_MARKER`).
   - `Input`: Single-line text input component.
   - `EditorComponent`: Interface defining `{ render(width: number): string[]; handleInput(data: string): void; invalidate(): void }`.
   - `Focusable`: Interface for tracking hardware cursor location (`focused: boolean`).

2. **`@earendil-works/pi-coding-agent`**:
   - `CustomEditor`: Extends `Editor` from `@earendil-works/pi-tui`. Implements app-level prompt keybindings (e.g. Escape to abort, Ctrl+D exit, model switching, line manipulation).
   - `ctx.ui.setEditorComponent`: Factory hook for replacing the main input editor component.

### Ownership Boundary

The permission prompt is rendered via an overlay/custom TUI component inside `ctx.ui.custom<PermissionResult>()`.
- **Top-Level Container**: The `PermissionPromptComponent` owns the overall dialog layout (header title, body text/diff, rule hints, scroll status, navigation & action hints).
- **Embedded Steering Editor**: When `steeringMode` is activated (via Tab), the prompt container delegates input and rendering to a dedicated `SteeringEditor` component.
- **Focus Propagation**: The prompt container implements `Focusable` and propagates `focused = true` to the `SteeringEditor` child, ensuring hardware cursor positioning (`CURSOR_MARKER`) works correctly during IME input.

---

## Integration Options & Evaluation

### Option 1: Manual Single-Line String Manipulation (Status Quo)
- **Pros**: Zero dependencies.
- **Cons**: No cursor movements (left/right/home/end), no modal editing, no line/word navigation, no IME cursor markers.
- **Verdict**: Unsuitable for Vim steering requirement.

### Option 2: Direct Raw `Editor` Embedding
- **Pros**: Reuses core buffer and cursor engine from `@earendil-works/pi-tui`.
- **Cons**: Standard `Editor` is non-modal by default and does not include Vim state management out-of-the-box without key routing logic.
- **Verdict**: Requires an adapter wrapper to handle modal state transitions.

### Option 3: `SteeringEditor` Adapter Component (Recommended)
- **Pros**:
  - Encapsulates `Editor` / modal editing logic in a dedicated module `extensions/tool-permissions/steering-editor.ts`.
  - Supports non-Vim pass-through editing and modal Vim editing (`"normal"` | `"insert"` modes).
  - Explicitly decouples dialog action shortcuts (`Ctrl+Y`, `Ctrl+D`, `Ctrl+A`, `Ctrl+Shift+A`) from text editing keys.
  - Exposes testable seams for non-interactive unit testing.
- **Verdict**: Selected path for implementation in e10s02.

---

## Modal Vim Behavior & Shortcut Disambiguation

### Mode State & Key Routing

When Vim mode is enabled for steering:
1. **Insert Mode (`"insert"`)**:
   - Printable characters append to or insert into the text buffer.
   - Standard backspace / delete edits text.
   - `Escape` switches editor mode to `"normal"`.
2. **Normal Mode (`"normal"`)**:
   - Navigation keys: `h` (left), `l` (right), `j` (down), `k` (up), `0` (line start), `$` (line end), `w` (word forward), `b` (word back).
   - Edit keys: `i` (enter insert mode), `a` (append after cursor), `x` (delete char), `u` (undo if supported).
   - Mode Indicator: Rendered in mode hint bar (e.g. `[NORMAL]` / `[INSERT]`).

### Disambiguation from Dialog Shortcuts

Dialog control shortcuts use modifier keys (`Ctrl`):
- `Ctrl+Y`: Allow once with steering text.
- `Ctrl+D`: Deny with steering text.
- `Ctrl+A`: Allow & save project rule with steering text.
- `Ctrl+Shift+A`: Allow & save user rule with steering text.
- `Escape` (in normal mode): Exit steering mode and return to main prompt navigation.

Because dialog actions rely on `Ctrl` modifiers, single-character Normal mode Vim keys (`d`, `y`, `a`) operate strictly on the text buffer without inadvertently triggering permission decisions.

---

## Compatibility Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **IME Candidate Positioning** | Container component must propagate `focused` state to `SteeringEditor` so `CURSOR_MARKER` escape sequence reaches TUI scanner. |
| **Shortcut Collision** | Require explicit `Ctrl` modifiers for dialog decisions, ensuring normal-mode Vim letters (`d`, `y`, `a`) do not settle permission requests. |
| **Prompt Overflow** | Bound the `SteeringEditor` rendered height to 1-3 lines inside the permission prompt footer. |
| **Non-Vim Regression** | Default `SteeringEditor` state operates in direct pass-through mode when Vim mode is disabled. |

---

## Automated Test Seams for e10s02

To verify configured Vim mode without interactive terminal hardware:
1. Expose `SteeringEditor` with public methods:
   - `handleInput(data: string): void`
   - `getValue(): string`
   - `setValue(text: string): void`
   - `getMode(): "normal" | "insert"`
   - `render(width: number): string[]`
2. Test harness in `extensions/tool-permissions/steering-editor.test.ts` can feed key sequence arrays (e.g. `["i", "h", "e", "l", "l", "o", "escape", "0", "x"]`) directly to `handleInput()` and assert `.getValue()` and `.getMode()` output.
