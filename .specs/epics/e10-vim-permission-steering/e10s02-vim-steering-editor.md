# e10s02 — Support configured Vim editing in permission steering

## User need
Users who enable Vim mode in the normal prompt editor need the Tab permission-steering editor to support the same modal editing behavior.

## Requirements
- Honor the user's configured editor mode.
- Support the normal prompt editor's relevant Vim motions, insertion, deletion, cursor, and mode indicators through the supported boundary selected by e10s01.
- Preserve permission-specific allow, deny, cancel, and save shortcuts without accidental activation while editing.
- Preserve existing non-Vim behavior.

## Acceptance criteria
- Vim users can enter insert mode, edit steering text, return to normal mode, and submit the intended text.
- Permission shortcuts remain distinct across editor modes.
- Non-Vim users retain existing behavior.
- The editor handles multiline steering if the reused prompt editor supports it.

## Verification
- `node --test extensions/tool-permissions/steering-editor.test.ts`
- `npm run check`
