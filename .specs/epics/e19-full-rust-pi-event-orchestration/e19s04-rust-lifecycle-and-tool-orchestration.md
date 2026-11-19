# Story e19s04: Move lifecycle and tool authorization orchestration into Rust

## 1. Business narrative
Tool authorization must have one Rust owner from session start through tool result and shutdown.

## 2. Actors
- Pi session
- Main and child agents
- Tool-permissions Rust runtime

## 3. Problem
TypeScript currently implements lifecycle handling, authorization decisions, tool-result annotations, and cleanup after Rust registration forwards events into the bridge.

## 4. Outcome
Rust implements these lifecycle and authorization callbacks with parity to existing user-visible permission outcomes.

## 5. Happy path
Rust observes session start, evaluates a tool call, returns an allow or block result, annotates the matching tool result, and clears session state at shutdown.

## 6. Alternative flows
- Invalid policy, path-trust, or callback input blocks or prompts according to existing contract.
- Session cancellation clears pending state and denies outstanding authorization.

## 7. Scope
Session start, tool-call authorization, tool-result handling, and shutdown cleanup.

## 8. Non-goals
Interactive prompt/editor/renderer migration and loader-only TypeScript cleanup.

## 9. Dependencies
- e19s01 through e19s03.
- Existing permission policy, path trust, audit, rule-save, and execution boundaries.

## 10. Assumptions
Existing parity tests express the required observable authorization contract.

## 11. Data model
Owned session state, tool-call identity, permission request/result, pending steering, and audit outcome.

## 12. Interfaces
Typed Rust lifecycle and tool handler interfaces own conversion from invocation payloads to domain requests and return Pi-compatible results.

**Reason for Depth:** The handlers centralize authorization invariants and prevent Pi event payloads from leaking through business logic.

## 13. Security and safety
All invalid or unavailable paths fail closed. Tool result annotations remain invocation-bound.

## 14. Observability
Parity tests capture allow, deny, cancellation, audit, and result-annotation outcomes.

## 15. Compatibility
Rule syntax, policy precedence, audit fields, and user-visible allow/deny behavior remain unchanged.

## 16. Requirements
#### MODIFIED: Lifecycle and tool authorization implementation owner
**Before:** TypeScript bridge callbacks own lifecycle processing and tool authorization after Rust registration.
**After:** Typed Rust callbacks own lifecycle processing and tool authorization while preserving observable results.

## 17. Acceptance criteria
```gherkin
Scenario: Rust authorizes an allowed tool call
  Given a session with an allowed permission rule
  When Pi emits a tool call
  Then Rust returns the existing allowed outcome
  And audit behavior remains equivalent

Scenario: Rust blocks a denied tool call
  Given a denied, invalid, or unavailable authorization path
  When Pi emits a tool call
  Then Rust returns a block outcome
  And it does not execute the tool

Scenario: Shutdown clears session state
  Given a session has pending authorization state
  When Pi emits session shutdown
  Then Rust clears that state
```

## 18. Out of scope
Prompt UI, steering editor, command behavior, preview rendering, and final TypeScript deletion.

## 19. Risks
Payload conversion differences can subtly change authorization. Parity tests must cover main/child requests and denied outcomes.

## 20. Implementation steps
1. Add parity contracts for Rust-owned session, authorization, result, and shutdown behavior → verify: `npm test -- extensions/tool-permissions`
2. Implement typed Rust lifecycle and tool orchestration through the safe callback boundary → verify: `npm test -- extensions/tool-permissions`
3. Remove migrated TypeScript lifecycle and authorization behavior without outcome drift → verify: `npm run check`

## Verification script
1. Run the tool-permissions suite.
2. Exercise one allowed and one denied tool call in Pi.
3. Confirm result annotation and shutdown cleanup match current behavior.
