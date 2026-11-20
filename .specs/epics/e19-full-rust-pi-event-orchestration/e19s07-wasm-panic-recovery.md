# Story e19s07: Handle WASM callback traps without authorizing tools

## 1. Business narrative

A Rust panic in the WASM permission runtime must not silently authorize a tool, leave the user without a useful explanation, or reuse corrupted state as though it were healthy.

## 2. Actors

- Pi extension host
- Tool-permissions maintainer
- User reviewing a failed permission request

## 3. Problem

WASI uses panic-abort. The first e19s01 exploratory probe observed a rejected Promise with `WebAssembly.RuntimeError: unreachable`; a later health request worked, but the scoped callback could no longer use its state. This one-off observation does not establish a safe recovery strategy.

## 4. Outcome

A reproducible isolated test characterizes synchronous and asynchronous WASM panic outcomes. Permission callbacks fail closed and surface an actionable error; the runtime either safely recreates its state or remains unavailable until explicit restart.

## 5. Happy path

1. A test-only WASM fixture intentionally panics in a registered Rust callback.
2. An isolated host observes the JavaScript result, process status, and runtime state.
3. The permission boundary blocks the affected tool call and reports the failure.
4. A verified recovery path creates fresh state, or the extension clearly requires a restart.

## 6. Alternative flows

- If the process exits or traps without a settled Promise, the test records that outcome without hanging the suite.
- If recovery cannot be proved safe, reject later authorization attempts and instruct the user to restart.
- Errors that are not WASM traps preserve their existing handling.

## 7. Scope

WASM panic/trap observability, fail-closed authorization, and a proven recovery or restart-required policy.

## 8. Non-goals

Introducing unsafe lifetime extensions, claiming `catch_unwind` works on panic-abort WASM, or allowing a tool because recovery is unavailable.

## 9. Dependencies

- e19s01 session-scoped callback lifecycle.
- e19s03 and e19s04 direct registration and authorization boundaries, or an equivalent explicit seam for testing them.
- Existing NAPI WASM build and Node test runner.

## 10. Assumptions

Panic behavior depends on target, build configuration, and where the panic occurs; the exploratory e19s01 result is evidence for one asynchronous path only.

## 11. Data model

Typed runtime health state, trap outcome, and fail-closed authorization result; do not retain JavaScript handles across asynchronous boundaries.

## 12. Interfaces

Use an isolated test-only panic fixture and the normal host/permission boundary. Do not add a production TypeScript callback bridge merely for recovery.

**Reason for Depth:** The runtime boundary owns fault classification, state invalidation, and safe recovery decisions instead of exposing callers to partial WASM state.

## 13. Security and safety

A panic, trap, failed restart, or unknown runtime health must not authorize a tool. Do not assume a successful health probe proves the rest of an instance is valid.

## 14. Observability

Record the process exit or signal, thrown or rejected JavaScript error, subsequent runtime behavior, and user-facing diagnostic.

## 15. Compatibility

Preserve ordinary callback and permission outcomes when no trap occurs.

## 16. Requirements

#### ADDED: WASM trap characterization and fail-closed recovery

A test proves the host-visible panic outcome and the permission boundary remains closed until recovery is demonstrated safe or a restart is required.

## 17. Acceptance criteria

```gherkin
Scenario: An asynchronous callback panics
  Given an isolated test-only WASM callback that panics
  When Pi invokes it
  Then the test records the rejection, thrown error, or process termination
  And the test does not hang or terminate the parent runner

Scenario: A permission callback traps
  Given a tool call awaiting authorization
  When the WASM permission callback traps
  Then the tool does not execute
  And the user receives an actionable diagnostic

Scenario: A trapped runtime cannot silently resume authorization
  Given a WASM trap has occurred
  When a later tool call arrives
  Then it is blocked until fresh runtime state is proved safe
  Or the extension reports that a restart is required
```

## 18. Out of scope

General process crash recovery, unrelated extensions, and assuming all traps are recoverable.

## 19. Risks

WASM may trap across FFI without unwinding destructors; a still-responsive export is not proof the runtime or session is safe to reuse.

## 20. Implementation steps

1. Add a test-only isolated WASM panic fixture and record synchronous and asynchronous host outcomes → verify: `npm test -- extensions/tool-permissions/native-registration.test.ts`
2. Implement and test fail-closed trap handling at the real authorization boundary → verify: `npm test -- extensions/tool-permissions/native-no-typescript-fallback.test.ts`
3. Prove safe runtime recreation or require restart after a trap → verify: `npm run check`

## Verification script

1. Build the normal WASM artifact and isolated test fixture.
2. Run the focused trap and authorization tests in child processes.
3. Confirm trapped or unavailable authorization never executes a tool.
4. Confirm recovery uses fresh verified state or explicitly requires restart.
