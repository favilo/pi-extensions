# Impact — e19s02 typed async prompt orchestration

## Target and purpose

`extensions/tool-permissions/native/crates/tool-permissions-native/src/prompt_queue.rs` owns the shared WASM prompt queue, request/decision binding, FIFO sequencing, and environment cleanup. `decide_prompt` exposes it through the N-API package.

## Dependents and contracts

- `extensions/tool-permissions/native-prompt-queue.ts`: calls `decidePrompt`, supplies the presenter, validates the bound result, and fails closed.
- `extensions/tool-permissions/index.ts`: supplies the Pi permission UI and cancellation handling.
- `extensions/tool-permissions/native-prompt-queue.test.ts`: checks real WASM FIFO, rejection, steering, and UI integration.
- `extensions/tool-permissions/prompt-queue.test.ts`: checks main/child serialization and cancellation semantics.
- `extensions/tool-permissions/native/package.json`, generated WASI loader, and root `package.json`: control packaging, runtime bootstrap, and test/build commands.
- Later stories e19s03–e19s06 depend on this boundary; e19s07 handles WASM panic recovery separately.

## Test coverage and gaps

Existing tests cover FIFO, identity binding, rejected presenters, steering, and visible UI sequencing. Add actual generated-loader async progress, JS-thread dispatch, synchronous throws, malformed returns, cancellation, environment teardown, late settlements, and runtime-unavailable failure. Miri covers Rust-owned queue state, not the JavaScript engine or N-API environment.

## Risk: High

This is a security-sensitive shared authorization boundary with asynchronous host and WASM lifecycle dependencies. Verify the CurrentThread runtime bootstrap before migrating the queue and use behavior-first RED/GREEN slices.
