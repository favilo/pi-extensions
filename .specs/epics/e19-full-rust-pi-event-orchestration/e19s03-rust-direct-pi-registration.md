# Story e19s03: Register Pi callbacks directly from Rust

## 1. Business narrative
Rust must register callbacks that invoke Rust behavior directly so the extension has one owner for event orchestration.

## 2. Actors
- Pi extension host
- Tool-permissions Rust runtime

## 3. Problem
Rust calls `pi.on` today but each registered callback forwards to named TypeScript bridge functions.

## 4. Outcome
Rust registers lifecycle, tool, command, and renderer callbacks directly, without TypeScript handler lookup or a bridge object.

## 5. Happy path
Rust receives Pi once, creates safe JavaScript-callable adapters backed by typed Rust handlers, and registers them through `pi.on`, `registerCommand`, and `registerEntryRenderer`.

## 6. Alternative flows
- Missing Pi capabilities cause initialization failure before partial registration.
- Invalid event payloads fail closed through the Rust adapter.

## 7. Scope
Registration ownership only; production event behavior migrates in following stories.

## 8. Non-goals
Removing the TypeScript loader or changing user-facing permission outcomes.

## 9. Dependencies
- e19s01 callback-lifetime proof.
- e19s02 Miri validation.
- Existing Pi API object capabilities [OK: local extension host API].

## 10. Assumptions
Pi's callback, command, and renderer registration interfaces remain callable from the existing safe NAPI wrapper.

## 11. Data model
Typed Rust handler traits and owned orchestrator state replace a dynamically named TypeScript bridge object.

## 12. Interfaces
`RegistrationBridge` becomes a Rust registration coordinator that constructs adapters for event, command, and renderer interfaces.

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
**After:** Rust calls Pi registration methods and each callback dispatches directly to typed Rust behavior without a TypeScript bridge object.

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
1. Add contracts covering direct Rust registration for each callback category and absence of bridge lookup → verify: `npm test -- extensions/tool-permissions/native-registration.test.ts`
2. Replace bridge-forwarding registration adapters with typed Rust handler adapters → verify: `npm test -- extensions/tool-permissions/native-registration.test.ts`
3. Remove the registration-time TypeScript bridge requirement while keeping the Pi handoff → verify: `npm run check`

## Verification script
1. Build native artifacts.
2. Run registration tests.
3. Confirm expected registration labels occur without named TypeScript handler access.
