# Story e19s01: Prove safe Rust Pi callback lifetime and dispatch

## 1. Business narrative

Tool-permissions must safely keep Rust-created Pi callbacks alive after initialization so later stories can move authorization behavior out of TypeScript without unsafe lifetime extension.

## 2. Actors

- Extension host (Pi)
- Tool-permissions Rust runtime
- Tool-permissions maintainer

## 3. Problem

The current Rust registration layer forwards Pi callbacks to TypeScript bridge handlers. No contract proves that a Rust-created handler can safely outlive initialization and dispatch after Pi invokes it.

## 4. Outcome

A minimal Rust-owned callback is registered with Pi, invoked after initialization returns, dispatches into owned Rust state, and releases per-session state during shutdown.

## 5. Happy path

1. TypeScript passes Pi to Rust initialization.
1. Rust creates a callback adapter that captures only owned Rust state.
1. Rust registers it through `pi.on`.
1. Pi invokes it after initialization returns.
1. The adapter converts invocation arguments at the NAPI boundary and dispatches to typed Rust logic.
1. Session shutdown releases state.

## 6. Alternative flows

- Invalid callback input is rejected without authorization.
- Initialization failure registers no partial authorization callback.
- Shutdown before a callback runs leaves no callable state behind.

## 7. Scope

A minimal tracer callback and its safe ownership boundary only.

## 8. Non-goals

- Migrating production permission behavior.
- Retaining JavaScript values across an asynchronous boundary.
- Unsafe pointer or forged static-lifetime techniques.

## 9. Dependencies

- e18s05 passing WASM-native framework.
- napi-rs managed callback APIs [OK: existing project dependency].

## 10. Assumptions

Pi continues to invoke callbacks as JavaScript functions and supplies the active NAPI callback context at invocation.

## 11. Data model

Owned Rust session/orchestrator state behind an `Arc`; transient JavaScript values exist only during callback invocation.

## 12. Interfaces

The Rust initializer receives Pi once. Rust registers a JavaScript-callable adapter through `pi.on`; the adapter dispatches to a typed Rust handler interface.

**Reason for Depth:** The orchestration state boundary hides NAPI lifetime details behind a small typed event-handler interface.

## 13. Security and safety

No borrowed `Env`, `Object`, `Function`, or `FunctionRef` may be stored in Rust callback state. Invalid input fails closed.

## 14. Observability

The integration test records registration, invocation, dispatch, and shutdown-release outcomes.

## 15. Compatibility

The existing registration contract remains available until e19s03 replaces bridge forwarding.

## 16. Requirements

#### ADDED: Safe Rust callback lifetime contract

Rust-created Pi callbacks must remain callable after initialization returns while capturing only owned Rust-managed state.

#### ADDED: Invocation-local JavaScript boundary

Callback inputs and NAPI context are consumed only for the active invocation and are not retained by orchestration state.

## 17. Acceptance criteria

```gherkin
Scenario: Rust callback dispatches after initialization
  Given Rust has initialized with Pi
  When Pi invokes the registered tracer callback after initialization returns
  Then typed Rust dispatch observes the event
  And no TypeScript bridge handler is invoked for the tracer callback

Scenario: Invalid callback input fails closed
  Given a Rust-created callback is registered
  When Pi invokes it with invalid input
  Then the callback rejects the input
  And it does not authorize a tool operation

Scenario: Shutdown releases callback state
  Given a callback has registered owned session state
  When session shutdown occurs
  Then Rust releases that state
  And later invocation cannot use stale state
```

## 18. Out of scope

Production permission migration, prompt queue Miri proof, and TypeScript loader removal.

## 19. Risks

NAPI callback APIs may not support the required async result shape without retaining JavaScript values. Detect through native integration tests before migration.

## 20. Implementation steps

1. Add an integration contract for a Rust-created callback invoked after initializer return → verify: `npm test -- extensions/tool-permissions/native-registration.test.ts`
1. Add owned Rust orchestrator state and a thin safe adapter that dispatches to typed Rust logic → verify: `npm test -- extensions/tool-permissions/native-registration.test.ts`
1. Add shutdown cleanup and invalid-input fail-closed coverage → verify: `npm test -- extensions/tool-permissions/native-registration.test.ts`

## Verification script

1. Build the native package.
1. Run the native registration test file.
1. Confirm the test shows Rust callback invocation after initialization and state release at shutdown.
