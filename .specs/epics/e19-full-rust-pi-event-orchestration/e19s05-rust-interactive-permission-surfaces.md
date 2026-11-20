# Story e19s05: Move interactive permission surfaces into Rust

## 1. Business narrative
Permission prompts, steering, commands, and previews must be Rust-owned so no TypeScript callback behavior remains.

## 2. Actors
- Interactive Pi user
- Pi TUI host APIs
- Tool-permissions Rust runtime

## 3. Problem
TypeScript owns prompt serialization, steering-editor state, permission command behavior, and preview renderer logic.

## 4. Outcome
Rust-owned callbacks use Pi host capabilities to preserve the interactive permission experience.

## 5. Happy path
Rust queues a permission prompt, presents it through Pi UI, accepts allow/deny/steering input, records the result, handles `/permissions`, and renders permission previews.

## 6. Alternative flows
- Noninteractive sessions use the existing confirmation fallback.
- Prompt cancellation denies and clears state.
- Failed rule save informs the user and does not authorize a call.

## 7. Scope
Prompt serialization, steering, queue ownership, command behavior, and preview rendering.

## 8. Non-goals
Replacing Pi TUI/editor runtime or changing shortcuts, rule syntax, and visible interaction semantics.

## 9. Dependencies
- e19s01 through e19s04.
- e19s02 Miri validation.
- Pi UI, command, and renderer APIs [OK: existing local host API].

## 10. Assumptions
Rust can invoke the necessary Pi host capabilities through safe adapters without retaining borrowed JS values.

## 11. Data model
Owned prompt identity, queue state, steering text, rule-save request, editor state, preview model, and settled permission result.

## 12. Interfaces
Typed Rust prompt, command, and renderer services call narrow Pi capability adapters.

**Reason for Depth:** Narrow capability adapters keep UI-host values at the NAPI edge while interactive state remains owned Rust data.

## 13. Security and safety
Cancellation, unavailable UI, malformed input, and save failures deny or preserve existing fail-closed behavior.

## 14. Observability
Parity tests cover prompts, steering association, command actions, renderer registration, and denial behavior.

## 15. Compatibility
Preserve visible prompts, keyboard shortcuts, command name, preview identifier, rule destinations, and audit effects.

## 16. Requirements
#### MODIFIED: Interactive permission behavior implementation owner
**Before:** TypeScript callbacks own prompts, steering, command handling, and preview rendering.
**After:** Rust callbacks own those behaviors while Pi supplies terminal UI and editor capabilities.

## 17. Acceptance criteria
```gherkin
Scenario: Rust presents and settles a permission prompt
  Given an interactive permission request
  When a user allows, denies, or provides steering
  Then Rust returns the corresponding existing permission result
  And steering remains bound to that invocation

Scenario: Prompt cancellation fails closed
  Given a queued prompt
  When the session cancels
  Then Rust resolves the prompt as denial
  And removes pending queue state

Scenario: Rust handles permissions command and preview
  Given Pi invokes the registered command or renderer
  When Rust handles it
  Then the existing command and preview outcomes are preserved
```

## 18. Out of scope
Deleting final TypeScript loader glue and changing Pi's own UI runtime.

## 19. Risks
TUI API gaps may expose a host capability unavailable through the current Rust wrapper. Detect via feature-parity integration tests before deleting TypeScript logic.

## 20. Implementation steps
1. Add parity contracts for prompt queue, steering, command, and renderer behavior → verify: `npm test -- extensions/tool-permissions`
2. Implement Rust-owned interactive services using narrow Pi host adapters → verify: `npm test -- extensions/tool-permissions`
3. Remove migrated TypeScript interactive callback behavior while preserving the interaction contract → verify: `npm run check`

## Verification script
1. Run permission extension tests.
2. In a TUI session, trigger a permission prompt, deny with steering, and invoke `/permissions`.
3. Confirm preview rendering and cancellation behavior match baseline.
