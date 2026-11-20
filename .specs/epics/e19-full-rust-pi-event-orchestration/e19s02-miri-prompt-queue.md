# Story e19s02: Use typed async prompt orchestration

## 1. Business narrative

Tool-permissions needs one Rust-owned prompt queue that awaits typed presenter results without forging JavaScript lifetimes or blocking Pi's event loop.

## 2. Actors

- Pi extension host and permission user
- Tool-permissions Rust runtime
- Maintainer verifying WASM lifecycle safety

## 3. Problem

The existing queue has removed its `FunctionRef` transmute and raw deferred `Send` implementation, but still uses a `PromiseRaw<'static, ...>` signature marker and manual promise callbacks. TypeScript currently supplies the presenter; Rust must safely invoke it and await its result without retaining invocation-local JavaScript values.

## 4. Outcome

A single Rust async queue invokes the presenter on its owning JavaScript thread, awaits a typed `Promise<PromptQueueResolution>`, and preserves FIFO, cancellation, teardown, and fail-closed permission behavior. A Tokio-free napi-rs runtime runs on the built WASM target.

## 5. Happy path

1. TypeScript calls the existing `decidePrompt` export with a request and presenter.
2. Rust admits the request to one process-shared FIFO queue and invokes the presenter on its owning JavaScript thread.
3. Rust awaits the typed promise without blocking the JavaScript event loop.
4. Rust returns the decision bound to the originating tool-call identity and advances the queue.

## 6. Alternative flows

- Synchronous presenter throws, rejected promises, and malformed values fail closed and do not strand the next prompt.
- Cancellation or shutdown denies affected work and prevents late results from authorizing.
- Runtime startup or loader failure does not authorize a tool.

## 7. Scope

Tokio-free async runtime setup, typed presenter invocation and awaiting, one shared prompt queue, lifecycle cleanup, and native/WASM integration tests. Runtime bootstrap is infrastructure, not a TypeScript permission callback bridge.

## 8. Non-goals

Migrating Pi permission UI or all callback behavior to Rust, adding Tokio, blocking Pi's JavaScript thread with `block_on`, or implementing WASM panic recovery (e19s07).

## 9. Dependencies

- e19s01 accepted safe callback boundary.
- `napi` 3.16.2 async-runtime SPI [OK: existing project dependency].
- `napi-async-runtime` 0.2.10 [OK: napi-rs companion; confirm compatible `napi-derive` before adding].
- `@napi-rs/async-runtime` [OK: napi-rs generated-loader host; confirm a compatible version before adding].
- `futures` [OK: established Rust ecosystem crate, if needed].

## 10. Assumptions

CurrentThread WASM support is a hypothesis until tested with the generated loader, including its task and timer hosts and teardown. TypeScript awaits the outer JavaScript Promise but does not poll Rust futures itself.

## 11. Data model

Owned prompt identity, FIFO queue position, typed resolution, and cancellation/lifecycle state. Invocation-local `Env`, `Object`, `Function`, and other JavaScript handles do not cross asynchronous suspension.

## 12. Interfaces

Retain the existing `decidePrompt(request, presenter): Promise<PromptQueueResponse>` contract. Use a typed `ThreadsafeFunction` with `call_async_catch` to dispatch the presenter on its owning JavaScript thread, then await the resulting `Promise<PromptQueueResolution>`. Do not call `borrow_back` with a captured environment from a worker.

**Reason for Depth:** The queue boundary hides FIFO scheduling, JavaScript-thread dispatch, cancellation, teardown, and fail-closed decisions behind one typed prompt interface.

## 13. Security and safety

Invalid input, presenter failures, cancellation, unavailable runtime, and shutdown must not authorize. No unsafe lifetime extension, raw deferred `Send` implementation, or borrowed JavaScript handles across suspension. The Clippy undocumented-unsafe lint remains enforced.

## 14. Observability

Integration tests observe presenter order, callback errors, decisions, loader startup, and cleanup. Miri results, if run, cover only Rust-owned code and do not prove N-API or JavaScript environment lifetime safety.

## 15. Compatibility

Keep prompt order, identity binding, steering, cancellation, and visible permission outcomes. Preserve `wasm32-wasip1-threads` and the generated `wasm32-wasi` flavor. No new production TypeScript presenter behavior.

## 16. Requirements

#### MODIFIED: Prompt queue async ownership

**Before:** Rust stores a typed `FunctionRef` with a `PromiseRaw<'static, ...>` signature marker and manually attaches promise callbacks; TypeScript supplies the presenter.

**After:** Rust uses a Tokio-free async runtime, JS-thread-safe presenter dispatch, and a typed Rust-awaitable `Promise<PromptQueueResolution>`, while TypeScript continues to supply the presenter until its later migration.

#### ADDED: Fail-closed async lifecycle

A prompt failure, cancellation, runtime failure, or shutdown cannot authorize a tool or allow a stale result to affect another request.

## 17. Acceptance criteria

```gherkin
Scenario: Runtime makes progress on the built WASM target
  Given the generated WASM loader and configured Tokio-free runtime
  When an asynchronous Rust operation awaits a JavaScript promise
  Then it settles without blocking the JavaScript event loop

Scenario: Prompts remain serialized and identity-bound
  Given two requests for the shared prompt queue
  When the first presenter is pending
  Then the second presenter does not open
  And each result remains bound to its originating request

Scenario: Presenter errors and cancellation fail closed
  Given a queued or active permission request
  When the presenter throws, rejects, returns malformed data, or the session cancels
  Then the affected request cannot authorize
  And eligible later work is not stranded

Scenario: Shutdown prevents stale authorization
  Given an active or queued prompt
  When the session or environment shuts down
  Then pending state is released or settled as denial as appropriate
  And a late presenter result cannot authorize
```

## 18. Out of scope

General WASM trap recovery, other extensions, production permission UI migration, and treating Miri as a JavaScript host safety proof.

## 19. Risks

Runtime and generated-loader versions may be incompatible; stop at the bootstrap gate if they cannot execute a real WASM async tracer. `ThreadsafeFunction` callback throws require `call_async_catch`. WASM panic-abort and environment teardown need separate evidence; do not assume a surviving health probe proves instance safety.

## 20. Implementation steps

1. Prove Tokio-free CurrentThread runtime bootstrap and async progress through the actual generated WASM loader; confirm dependency compatibility and no new security findings → verify: `npm run build:native && npx tsx --test extensions/tool-permissions/native-prompt-queue.test.ts`
2. Replace presenter storage/dispatch with a typed JS-thread-safe async callback and await `Promise<PromptQueueResolution>`; preserve FIFO and identity binding and review affected paths for new security findings → verify: `npm run build:native && npx tsx --test extensions/tool-permissions/native-prompt-queue.test.ts`
3. Cover throws, rejected/malformed results, cancellation, shutdown, and late settlements; ensure no new security findings in affected paths → verify: `npm run build:native && npx tsx --test extensions/tool-permissions/native-prompt-queue.test.ts`
4. Run the full project check and review affected paths for new security findings → verify: `npm run check`

Each behavioral change uses a failing behavioral test in a separate Jujutsu change before implementation. Existing exports or minimal stubs must exist before RED; missing modules or harness failures are not valid RED.

## Verification script

1. Build the native WASM package and run the focused prompt-queue tests.
2. Confirm the async tracer progresses through the generated loader and presenter runs on its owning JS thread.
3. Confirm FIFO, identity binding, throws, rejections, malformed results, cancellation, shutdown, and late-result denial.
4. Run `npm run check`; optionally run `cargo +nightly miri test --manifest-path extensions/tool-permissions/native/Cargo.toml -p tool-permissions-native prompt_queue` as a Rust-only check.

## Prior Art

- **Adopt/verify:** `napi-async-runtime` 0.2.10, https://docs.rs/napi-async-runtime/0.2.10/napi_async_runtime/. Its `install(RuntimeOptions)` registers an async-runtime backend; its CurrentThread WASM flavor requires generated-loader task/timer hosts.
- **Compose:** napi-rs `ThreadsafeFunction::call_async_catch` and `Promise<T>`, https://napi.rs/docs/concepts/threadsafe-function and https://napi.rs/docs/concepts/async-runtime. The first await obtains the presenter's JavaScript promise; the second obtains its owned resolution.
- **Retain until replaced:** `extensions/tool-permissions/native/crates/tool-permissions-native/src/prompt_queue.rs` is the current single-queue implementation and compatibility baseline.
- **Compose, with host lifecycle tests:** napi-rs 3.16.2 `src/bindgen_runtime/env_registration.rs` keeps per-load records keyed by the live `napi_env`, assigns each registration a non-reused ID, and removes the record in an environment cleanup hook before address reuse. Its registration IDs and lookup are `pub(crate)`, not a public identity API. A project-owned registry could follow this pattern, but must verify registration, cleanup ordering, address reuse, and WASI teardown; do not dereference or retain `Env` across suspension.
- **Avoid unowned instance-data slot:** napi-rs 3.16.2 `Env::set_instance_data` documents replacing existing per-environment data without running the previous finalizer. The slot cannot be assumed exclusive; the installed emnapi implementation also stores one instance-data value per environment. Do not claim it without an explicit ownership contract.
- **Lifecycle experiment:** repeated generated WASI loader creation and disposal yielded the same numeric env address on each independent WASM instance. This shows address reuse across instances, not reuse inside one shared registry. A deterministic registry test supplies the same key after cleanup and checks a fresh ID and stale-cleanup isolation. A further loader probe disposed with a pending presenter, settled its old promise late, and observed a later same-tool-ID prompt deny; the old prompt's post-disposal promise was not asserted to settle.
