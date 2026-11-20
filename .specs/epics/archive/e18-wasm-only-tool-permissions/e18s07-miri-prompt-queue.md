# e18s07 — Prove the prompt-queue lifetime erasure under Miri

## 1. Identity
- **Story:** e18s07
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 3
- **Risk:** P0
- **Delta:** ADDED

## 2. User need
`persistent_present` erases the `FunctionRef` lifetime so the prompt queue can hold a host callback. That step is an `unsafe` transmute justified by a comment. A wrong lifetime can call the presenter after its N-API environment is gone.

## 3. Goal
Miri executes the prompt queue's lifetime-erasure path and reports no undefined behavior. The production queue uses that same path.

## 4. Non-goals
- Running Miri on the WASM artifact, the Node loader, or the JavaScript engine.
- Replacing `napi-rs` or changing the prompt, steering, or queue behavior.
- Copying this pattern into e18s05 or another host callback.
- Removing the TypeScript load-failure fallback. That is e18s06.

## 5. Users
Maintainers who change the native prompt queue or reuse its callback storage.

## 6. User journey
A maintainer runs the Miri test for the prompt queue. Miri borrows the erased presenter only with the captured environment, including the case where that environment has already ended. The test fails on undefined behavior. The normal `cargo test` queue tests still pass.

## 7. Preconditions
- e18s04 stores the presenter with `persistent_present` in `extensions/tool-permissions/native/crates/tool-permissions-native/src/prompt_queue.rs`.
- The queue rejects a second N-API environment while work is queued.
- e18s00 recorded `decision: reject` for `pi-oxidized-ext`. This story stays on the standalone NAPI package.

## 8. Inputs
The erased `FunctionRef`, the captured N-API environment identity, and a Miri run of the prompt-queue lifetime tests.

## 9. Outputs
A Miri-clean lifetime-erasure test. The production queue calls that checked helper. A documented command that reproduces the Miri result.

## 10. Requirements
#### ADDED: Miri checks the erased presenter
The lifetime erasure is executable under Miri without calling the JavaScript engine. Miri reports no undefined behavior when the presenter is used with its captured environment, and it reports undefined behavior if a test uses that presenter after the captured environment ends.

#### ADDED: The production queue uses the checked helper
`persistent_present` and `open_next` go through the helper Miri executed. A mismatched environment is still rejected before the presenter is borrowed.

## 11. Quality attributes
The unsafe region is small enough for Miri to execute, and a late borrow is visible as undefined behavior.

## 12. Interfaces and contracts
Prompt decisions, tool-call binding, and steering text stay as e18s04 defined them. This story changes how the presenter reference is checked, not the decision it returns.

## 13. State
No new persistent state. The queue remains process-local.

## 14. Dependencies
- `persistent_present` and `open_next` in `prompt_queue.rs`.
- e18s04 prompt-queue tests.
- `.specs/security/epics/e18/THREAT_MODEL.md` threat 8.

## 15. Failure modes
Miri only runs an unrelated safe test while the transmute stays unchecked. The helper Miri executed is not the one the queue calls. A late borrow is treated as success.

## 16. Observability
The Miri command prints the prompt-queue lifetime test name and a pass or undefined-behavior result. A mismatch between the helper under test and the production queue fails the Rust test.

## 17. Acceptance criteria
### Scenario: Miri accepts a borrow inside the captured environment
**Given** a presenter erased for one captured environment
**When** `cargo miri test` runs the prompt-queue lifetime test and the borrow uses that environment
**Then** Miri finishes that test with no undefined behavior.

### Scenario: Miri rejects a borrow after the captured environment ends
**Given** the same erased presenter
**When** a test borrows it after the captured environment is gone
**Then** Miri reports undefined behavior and the test run fails.

### Scenario: The queue still rejects a different environment
**Given** queued prompt work captured for one N-API environment
**When** a second environment tries to open the next prompt
**Then** the queue rejects that environment before borrowing the presenter.

## 18. Automated verification
- `cargo miri test --manifest-path extensions/tool-permissions/native/Cargo.toml -p tool-permissions-native -- lifetime_erasure`
- `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml -p tool-permissions-native -- prompt_queue`

## 19. Implementation steps
1. Add a failing Miri test that borrows the erased presenter after its captured environment ends. → verify: `cargo miri test --manifest-path extensions/tool-permissions/native/Cargo.toml -p tool-permissions-native -- lifetime_erasure`
2. Route `persistent_present` through the helper that test executes, without calling the JavaScript engine from the Miri test. → verify: `cargo miri test --manifest-path extensions/tool-permissions/native/Cargo.toml -p tool-permissions-native -- lifetime_erasure`
3. Keep the mismatched-environment rejection on that helper. → verify: `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml -p tool-permissions-native -- prompt_queue`
4. Run the native tests. No new security findings in affected paths. → verify: `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml`

## 20. Definition of done
Miri has executed the prompt queue's lifetime erasure. A borrow after the captured environment ends is undefined behavior. The production queue uses that checked path and still refuses a different N-API environment.
