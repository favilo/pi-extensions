# Story e19s08: Move lifecycle behavior and shutdown cleanup into Rust

## Outcome
Rust owns startup behavior and final shutdown cleanup without changing notices, audit, cancellation, or authorization outcomes. The existing TypeScript lifecycle callback is temporary, not the final design.

## Dependencies
Complete migration of the relevant authorization/result and interactive state owners in e19s04 and e19s05 before final shutdown cleanup. Those stories may interleave. Independent startup behavior may migrate earlier with parity tests. e19s06 follows completion of this story. e19s07 remains a cross-cutting fail-closed gate.

## Modified requirement
**Before:** a Rust shutdown guard delegates product cleanup to TypeScript.
**After:** Rust clears its session-owned authorization, steering, preview and prompt state, and performs equivalent startup notifications and audit.

## Acceptance criteria
- Startup preserves YOLO notification and audit and debug-log notification where applicable.
- Shutdown clears all migrated state, aborts session prompt presentations, closes the prompt queue and denies late confirmations.
- Cleanup executes once, returns asynchronous completion to the host, and leaves authorization unavailable on failure.
- The temporary TypeScript lifecycle capability is removed only after behavior parity is proven.

## Verification script
1. Run the tool-permissions tests and `npm run check`.
2. In Pi, exercise startup notices and audit, an active prompt during shutdown, and a late confirmation. Confirm no late tool authorization.
