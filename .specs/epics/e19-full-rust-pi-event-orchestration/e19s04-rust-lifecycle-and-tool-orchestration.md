# Story e19s04: Move tool authorization and result orchestration into Rust

> **Replanned scope:** This story owns tool authorization and result handling. Lifecycle startup and final shutdown cleanup are transferred to e19s08, after state owners in e19s04 and e19s05 migrate. References to lifecycle completion below describe the original combined scope and are superseded by this note. Temporary lifecycle callbacks remain until e19s08. Coordinate shared state with e19s05; the stories may interleave.

## 1. Business narrative
Tool callback registration, invocation validation, fail-closed session guarding, and result orchestration must move into Rust while policy dispatch and interactive UI remain temporary TypeScript capabilities until their dedicated migration stories complete.

## 2. Actors
- Pi session
- Main and child agents
- Tool-permissions Rust runtime

## 3. Problem
TypeScript currently implements lifecycle handling, policy dispatch, interactive UI, tool-result annotations, and cleanup after Rust registration forwards events into the bridge. The replan assigns interactive migration to e19s05, final lifecycle cleanup to e19s08, and bridge removal to e19s06.

## 4. Outcome
Rust registers the tool callbacks directly, validates invocation payloads, rejects calls after session closure, owns invocation-bound steering/result annotation, and preserves existing user-visible permission outcomes through temporary TypeScript policy/UI capabilities.

## 5. Happy path
Rust observes a tool call, validates it, rejects it if the session is closed, invokes the temporary policy host capability while active, annotates the matching tool result with Rust-owned steering, and clears its owned session state at shutdown.

## 6. Alternative flows
- Invalid policy, path-trust, or callback input blocks or prompts according to existing contract.
- Session cancellation clears pending state and denies outstanding authorization.

## 7. Scope
Direct Rust registration of tool-call and tool-result callbacks; malformed-call validation; session-closure fail-closed guards; Rust-owned invocation-bound steering/result annotation; and parity verification. Startup behavior, final shutdown cleanup, interactive prompt/editor/renderer behavior, policy dispatch, and bridge removal are sequenced to e19s05, e19s08, and e19s06.

## 8. Non-goals
Interactive prompt/editor/renderer migration, policy dispatch migration, startup behavior, final shutdown cleanup, and loader-only TypeScript cleanup.

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
#### MODIFIED: Tool callback orchestration owner
**Before:** TypeScript bridge callbacks register tool handlers and own invocation validation, session-closure guarding, steering state, and tool-result annotation.
**After:** Typed Rust callbacks register tool handlers directly and own invocation validation, session-closure guarding, invocation-bound steering state, and tool-result annotation. Temporary TypeScript policy dispatch and interactive UI capabilities remain until e19s05/e19s06; final lifecycle cleanup remains e19s08.

## 17. Acceptance criteria
```gherkin
Scenario: Rust validates and dispatches an allowed tool call
  Given an active session with an allowed permission rule
  When Pi emits a well-formed tool call
  Then Rust invokes the temporary policy capability
  And Pi receives the existing allowed outcome

Scenario: Rust blocks malformed or late tool calls
  Given a malformed tool call or closed session
  When Pi emits a tool call
  Then Rust returns a block outcome
  And it does not execute the tool

Scenario: Rust annotates the matching result
  Given Rust has steering for one tool-call identity
  When Pi emits that tool result
  Then Rust annotates only that matching result
  And consumes the steering exactly once
```

## 18. Out of scope
Prompt UI, steering editor, command behavior, preview rendering, and final TypeScript deletion.

## 19. Risks
Payload conversion differences can subtly change authorization. Parity tests must cover main/child requests and denied outcomes.

## 20. Implementation steps
1. Add parity contracts for Rust-owned tool callback registration, validation, late-call rejection, result annotation, and shutdown guards → verify: `npm test -- extensions/tool-permissions`
2. Implement typed Rust callback orchestration through the safe callback boundary → verify: `npm test -- extensions/tool-permissions`
3. Retain explicit temporary TypeScript policy/UI capabilities with TODOs and prove no outcome drift → verify: `npm run check`

## Verification script
1. Run the tool-permissions suite.
2. Exercise one allowed and one denied tool call in Pi.
3. Confirm Rust-owned result annotation/steering, shutdown fail-closed behavior, and clean relaunch match current behavior.
4. Confirm the remaining TypeScript policy/UI bridge is documented as e19s05/e19s06 work, not counted as e19s04 ownership.
