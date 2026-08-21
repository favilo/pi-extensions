# e06s06 — Switch between live subagent transcript panels

## 1. Identity
- **Story:** e06s06
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 3
- **Risk:** P0
- **Delta:** ADDED

## 2. User need
Users need to inspect what background subagents are doing without losing access to the main conversation or hiding permission requests.

## 3. Goal
Provide a read-only live transcript panel for each child and a configurable `Ctrl+Tab` shortcut that cycles between the main session and active or retained child panels.

## 4. Non-goals
- Typing messages or steering a child from its panel.
- Displaying private provider reasoning.
- Persisting transcript panels across exit or reload.
- Replacing the existing main-window permission UI.

## 5. Requirements
- Render exposed assistant messages, tool calls, partial tool updates, tool results, status, and terminal outcomes from the normalized child event contract.
- Register a configurable `Ctrl+Tab` shortcut to cycle main → child panels → main.
- Keep the main editor available whenever the main panel is selected; `Escape` returns from a child panel to main.
- Label every panel and event with stable child identity and status.
- Route child permission prompts to the existing main-window permission UI regardless of the visible panel.
- Pause only the requesting child while permission is pending.
- Serialize simultaneous child permission prompts so modal interactions cannot overlap or consume another child's decision.
- Keep transcript rendering bounded, scrollable, width-safe, and responsive to streaming updates.

## 6. Failure modes
Focus loss, shortcut collision, hidden permission prompt, overlapping modals, event misattribution, stale panels, narrow terminal layout, excessive transcript growth, and completion during panel switching.

## 7. Preconditions
- E06s05 exposes stable child IDs, statuses, and bounded normalized events.
- Existing tool-permissions owns every permission decision.

## 8. Inputs
Child registry snapshots and events, active panel selection, keyboard input, theme, terminal dimensions, and permission requests.

## 9. Outputs
Switchable read-only transcript panels and serialized main-window permission interactions.

## 10. Quality attributes
Foreground usability, clear attribution, deterministic focus, bounded rendering cost, and fail-closed permission behavior.

## 11. Interfaces and contracts
- UI consumes the project-owned normalized child event contract, not raw provider events.
- `pi.registerShortcut("ctrl+tab", ...)` selects panels; custom TUI/overlay focus returns cleanly to the existing editor.
- The permission queue wraps presentation only; policy evaluation remains in `tool-permissions`.

## 12. State
The parent session owns selected-panel state, visible child ordering, and a FIFO permission-prompt queue. All UI state is ephemeral across reload and exit.

## 13. Dependencies
- `[OK] @earendil-works/pi-coding-agent` — existing shortcut, message, and custom UI APIs.
- `[OK] @earendil-works/pi-tui` — existing component, focus, key matching, and rendering APIs.
- E06s05 normalized child event stream; no new package.

## 14. Failure modes
Prompt arrives while a child panel owns focus, child completes while selected, panel closes during an update, duplicate child names, and user cancels a permission prompt.

## 15. Observability
Show safe event type, child ID, status, elapsed time, pending permission state, and truncation. Never label hidden chain-of-thought as available output.

## 16. Impact
Adds a persistent session-scoped UI surface and shortcut around the existing subagent tool. It must compose with current custom editors, tool rendering, and permission dialogs rather than replacing them.

## 17. Acceptance criteria
### Scenario: Switch while a child runs
**Given** a background child is streaming events
**When** the user presses `Ctrl+Tab`
**Then** the child transcript becomes visible and continues updating without blocking the child or parent.

### Scenario: Return to foreground
**Given** a child transcript is selected
**When** the user presses `Escape` or cycles to main
**Then** the existing main editor regains focus and can submit new work.

### Scenario: Child permission request
**Given** any child requests permission while any panel is visible
**When** the request reaches the parent
**Then** the existing main-window prompt displays the child identity, only that child waits, and the decision is returned to that child.

### Scenario: Concurrent permission requests
**Given** multiple children request permission concurrently
**When** the prompts are presented
**Then** they are handled one at a time in FIFO order and no decision crosses child identity.

## 18. Automated verification
- `node --test extensions/subagent/transcript-panel.test.ts`
- `node --test extensions/subagent/permission-prompt-queue.test.ts`
- `npm run check`

## 19. Implementation steps
1. Render a bounded read-only transcript from normalized child events → verify: node --test extensions/subagent/transcript-panel.test.ts
2. Add configurable panel cycling and deterministic focus return → verify: node --test extensions/subagent/transcript-panel.test.ts
3. Route and serialize child permission prompts through the main UI → verify: node --test extensions/subagent/permission-prompt-queue.test.ts
4. Run package regression checks → verify: npm run check

## 20. Definition of done
Users can switch between the usable main session and live read-only child transcripts, while every child permission request remains visible, attributable, serialized, and enforced by the existing boundary.
