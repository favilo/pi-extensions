# e11s03 — Show complete Bash commands and output in expanded history

## User need
When expanding tool history with Ctrl+O, users need the complete Bash command and complete captured output, not the compact 80-character command and 20-line preview.

## Requirements
- Keep the default Bash row compact.
- In expanded history, render the full unshortened command actually sent to the Bash tool before its output.
- Render all output retained by the Bash tool; when upstream truncation occurred, clearly identify it.
- Preserve multiline command formatting.

## Acceptance criteria
- Collapsed history remains concise.
- Ctrl+O reveals the complete formatted command and all retained output.
- Long and multiline commands are not silently shortened in expanded history.
- Upstream output truncation remains visible and is not presented as complete output.

## Verification
- `node --test extensions/built-in-tool-renderer/bash-history.test.ts`
- `npm run check`
