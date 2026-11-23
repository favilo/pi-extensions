# Impact: e19 lifecycle migration order

## Target

Move startup, shutdown and tool authorization behavior out of `extensions/tool-permissions/index.ts` without losing permission or cancellation parity.

## Dependencies and affected stories

- **e19s04 authorization and result handling:** `handleRegisteredToolResult` consumes `pendingSteering` and `promptedPreviews`; shutdown clears those same stores. Their ownership must move together or cleanup must be delegated across the temporary boundary.
- **e19s05 interactive surfaces:** shutdown also clears `pendingPreviewReviews` and `previewReviewOverrides`, aborts session prompt presentations, and closes the session prompt queue. Moving only shutdown now would still call TypeScript-owned state and would have to change again when interactive ownership moves.
- **e19s04 startup:** YOLO notice and audit, and debug-log notice, are independent of those shutdown stores; they can migrate earlier if equivalent host capabilities and tests exist.
- **e19s06:** removing the bridge must follow migration of both authorization and interactive state and their cleanup.
- **e19s07:** WASM trap recovery is a cross-cutting safety story. Its current tasks do not establish a mandatory dependency on either s04 or s05; test the eventual boundary and ensure traps fail closed.

## Existing intermediate work

The working tree contains a single scoped shutdown guard, which revokes the scope and forwards a temporary TypeScript cleanup callback. It is infrastructure, not Rust-owned product cleanup. Its TODO requires eventual removal of the temporary capability. Review the current uncommitted changes and preserve existing behavior before treating this slice as complete.

## Tests and gaps

- `native-registration.test.ts`: single guard, one cleanup invocation, and return of async cleanup promise.
- `native-prompt-queue.test.ts` and `index.test.ts`: prompt cancellation, shutdown and late confirmation behavior.
- Gap: prove the final Rust-owned shutdown clears all migrated stores and closes the prompt lifecycle, including cleanup failure and late authorization, after their owners move.
- Gap: startup parity for YOLO audit/notice and debug notice when moved into Rust.

## Risk: High

Shared authorization and prompt state is security-sensitive; incorrect ordering can leave late confirmations or stale session data able to influence later work.

## Recommended sequencing

Split e19s04 rather than treating its current all-or-nothing order as a dependency: migrate authorization/result ownership and the interactive state owners in dependency-aware vertical slices (e19s04/e19s05 may interleave); move final product shutdown cleanup after those state owners; then perform e19s06 bridge removal. Move independent startup behavior earlier only with parity tests. Keep e19s07 visible as a cross-cutting fail-closed gate. Replan the story capsules and statuses before implementation; do not mark e19s08 passing until its lifecycle acceptance criteria are met. Story traceability generation is waived by the user.
