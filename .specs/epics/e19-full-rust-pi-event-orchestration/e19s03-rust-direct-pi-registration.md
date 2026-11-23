# Story e19s03: Register Pi callbacks directly from Rust

## 1. Business narrative
Rust must register callbacks that invoke Rust behavior directly so the extension has one owner for event orchestration.

## 2. Actors
- Pi extension host
- Tool-permissions Rust runtime

## 3. Problem
Rust calls `pi.on` today but each registered callback forwards to named TypeScript bridge functions.

## 4. Outcome
A non-production direct-registration contract proves Rust can register lifecycle, tool, command, and renderer callbacks directly without a TypeScript bridge. Production retains its existing bridge until behavior migrates in e19s04–e19s05.

## 5. Happy path
The direct-registration harness receives Pi once, creates JavaScript-callable adapters backed by typed Rust handlers, and registers them through `pi.on`, `registerCommand`, and `registerEntryRenderer`.

## 6. Alternative flows
- Missing Pi capabilities cause initialization failure before partial registration.
- Invalid event payloads fail closed through the Rust adapter.

## 7. Scope
A separate direct-registration contract harness and its tests only. Production registration and behavior remain unchanged until migration in following stories.

## 8. Non-goals
Removing the TypeScript loader or changing user-facing permission outcomes.

## 9. Dependencies
- e19s01 callback-lifetime proof.
- e19s02 typed async prompt queue; Miri covers Rust-owned state only, not JavaScript host lifetimes.
- Existing Pi API object capabilities [OK: local extension host API].

## 10. Assumptions
Pi's callback, command, and renderer registration interfaces remain callable from the existing safe NAPI wrapper.

## 11. Data model
Typed Rust handler traits and owned orchestrator state replace a dynamically named TypeScript bridge object.

## 12. Interfaces
A single Rust-only `ScopedPi` owns a shared revocable session lifetime. `ScopedPi::register_callback()` passes a reference to itself into each `Callback::register`; its `on` and `register_command` methods guard handler invocation. All callbacks shut down together. Async continuations must re-check session state after suspension. Callback implementations do not manage shutdown. The Pi wrapper accepts the host object through `FromNapiValue` when safe, preserving method receivers and N-API lifetimes. The existing production `RegistrationBridge` remains until its handlers migrate.

**Reason for Depth:** A registration coordinator isolates Pi API wiring from typed event-handler implementations.

## 13. Security and safety
Registration failure cannot leave a callback that silently allows a tool. Unsupported host capability fails closed.

## 14. Observability
Native registration tests record the registered names and prove no bridge lookup occurs.

## 15. Compatibility
The same Pi event names and command/renderer identifiers are preserved.

## 16. Requirements
#### MODIFIED: Native registration ownership
**Before:** Rust calls Pi registration methods and forwards each callback to a named TypeScript bridge handler.
**After:** A separate Rust registration harness registers and dispatches each callback class to typed Rust behavior without a TypeScript bridge object. Production bridge forwarding remains in place until subsequent stories replace it.

## 17. Acceptance criteria
```gherkin
Scenario: Rust registers every callback class
  Given the Rust runtime receives Pi
  When initialization succeeds
  Then Rust registers lifecycle, tool, command, and renderer callbacks
  And registration needs no TypeScript bridge object

Scenario: Missing Pi registration capability fails closed
  Given Pi lacks a required registration method
  When Rust initializes
  Then initialization fails
  And no partial authorization registration is reported
```

## 18. Out of scope
Migration of lifecycle, tool, prompt, or renderer behavior.

## 19. Risks
Registration APIs have incompatible result signatures; native integration tests must prove each callback category before behavior moves.

## 20. Implementation steps
1. Add contracts covering direct registration for each callback category and absence of bridge lookup → verify: `npm test -- extensions/tool-permissions/native-registration.test.ts`
2. Implement separate direct-registration adapters backed by typed Rust handlers → verify: `npm test -- extensions/tool-permissions/native-registration.test.ts`
3. Prove the production bridge and existing permission behavior remain intact → verify: `npm run check`

## Verification script
1. Build native artifacts.
2. Run registration tests.
3. Confirm expected registration labels occur without named TypeScript handler access.
