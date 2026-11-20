# e10s02 — Support configured Vim editing in permission steering

## User need
Users who enable Vim mode in the normal prompt editor need the Tab permission-steering editor to support the same modal editing behavior.

## Requirements
- Honor the user's configured editor mode.
- Support the normal prompt editor's relevant Vim motions, insertion, deletion, cursor, and mode indicators through the supported boundary selected by e10s01.
- Preserve permission-specific allow, deny, and save shortcuts without accidental activation while editing.
- In Vim insert mode, Escape returns to normal mode. Further Escape presses stay in the steering editor. Tab in normal mode leaves steering.
- Escape does not cancel the permission prompt. Ctrl+D denies. An abort still cancels.
- Non-Vim Escape leaves steering and returns to the permission prompt.

## Acceptance criteria
- Vim users can enter insert mode, edit steering text, return to normal mode, and submit the intended text.
- One Escape from Vim insert stays in the editor. Another Escape does not leave steering and does not settle the prompt.
- Tab in Vim normal mode leaves steering without submitting.
- Escape on the main permission prompt does not settle it.
- Non-Vim Escape leaves steering and does not cancel the prompt.
- The editor handles multiline steering if the reused prompt editor supports it.

## Verification
- `node --test extensions/tool-permissions/steering-editor.test.ts`
- `npm run check`
