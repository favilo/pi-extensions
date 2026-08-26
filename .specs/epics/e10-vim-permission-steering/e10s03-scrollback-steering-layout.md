# e10s03 — Refactor permission prompt layout for native scrollback and inline Vim steering editor

## User need
Users inspecting large diffs, file write contents, or multiline shell commands in permission prompts need to view full untruncated content in the terminal scrollback buffer, with the Vim steering editor and action hints anchored cleanly above the footer.

## Goal
Refactor `presentScrollablePermission` / `askScrollablePermission` and prompt layout so request bodies render directly for native terminal scrollback accessibility, and the Vim-capable `SteeringEditor` and decision hints sit anchored directly above the footer.

## Deliverables
- Refactored prompt layout in `extensions/tool-permissions/index.ts`.
- Inline `SteeringEditor` rendering directly above decision action hints without inner sub-window clipping.
- Dynamic Vim mode hint guidance (`[INSERT]` vs `[NORMAL]` state handling).
- Unit tests verifying prompt layout and decision actions.

## Acceptance criteria
- Full request bodies render without sub-window height clipping, allowing native terminal scrollback navigation.
- `SteeringEditor` renders inline above the action hints without box border artifacts.
- Navigation hints dynamically indicate `Esc` normal mode vs `Esc` exit steering based on editor state.
- All preflight unit tests and `npm run check` pass cleanly.

## Verification
- `node --test extensions/tool-permissions/steering-editor.test.ts extensions/tool-permissions/index.test.ts`
- `npm run check`
