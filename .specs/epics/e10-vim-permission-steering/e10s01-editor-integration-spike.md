# e10s01 — Spike reuse of Pi prompt editor input behavior

## User need
Permission steering should inherit the normal prompt editor's editing model instead of maintaining a separate one-line input implementation.

## Goal
Determine whether the permission prompt can embed or adapt Pi's supported editor component and keybindings, including configured Vim mode, without importing unstable internals.

## Deliverables
- Document the supported TUI/editor API and ownership boundary.
- Prototype input, cursor movement, mode changes, cancellation, and submission.
- Choose reuse, adapter, or minimal local implementation with explicit compatibility risks.
- Define automated seams for Vim-mode tests.

## Acceptance criteria
- The spike records a supported implementation path or a clear blocker.
- The selected path preserves permission shortcuts and focus behavior.
- No production behavior ships from the spike alone.

## Verification
- `test -f .specs/epics/e10-vim-permission-steering/SPIKE-editor-integration.md`
- `npm run typecheck`
