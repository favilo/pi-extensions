# Story e19s06: Reduce TypeScript to the WASM loader and one-time handoff

## 1. Business narrative
The extension entrypoint must visibly demonstrate single Rust ownership: TypeScript loads WASM and hands Pi over once; it performs no permission work.

## 2. Actors
- Pi extension loader
- Tool-permissions Rust runtime
- Maintainer

## 3. Problem
Even after individual native operations moved to WASM, `index.ts` contains callback implementations, registration bridge construction, and permission behavior.

## 4. Outcome
`index.ts` is limited to native module loading and one Rust initialization handoff. Rust owns all callback registration and permission behavior.

## 5. Happy path
Pi loads `index.ts`; it loads the native/WASM module, passes Pi once to Rust initialization, and Rust performs all registration and behavior.

## 6. Alternative flows
- Missing or invalid WASM fails closed and cannot authorize a tool.
- Rust initialization failure reports a fatal native-engine error rather than falling back to TypeScript.

## 7. Scope
Final removal of TypeScript callback registration, bridge, permission behavior, and fallback paths.

## 8. Non-goals
Deleting the TypeScript entrypoint or changing Pi's package loading mechanism.

## 9. Dependencies
- e19s01 through e19s05.
- Existing native load-fatal boundary.

## 10. Assumptions
All production callback categories and interactive behaviors have passing Rust parity contracts before removal begins.

## 11. Data model
No TypeScript permission domain state remains; initialization inputs are Pi and native module availability only.

## 12. Interfaces
The entrypoint exposes only a loader and one-time `initialize(pi)`-style Rust handoff.

**Reason for Depth:** A minimal entrypoint makes ownership auditable and prevents accidental reintroduction of TypeScript permission behavior.

## 13. Security and safety
Unavailable, malformed, or failed native initialization is deny-by-default. No fallback may authorize a tool.

## 14. Observability
Structural tests prove entrypoint contents; behavior tests prove unavailable WASM cannot allow a request.

## 15. Compatibility
Pi continues to discover the extension using the TypeScript package entry.

## 16. Requirements
#### REMOVED: TypeScript permission callback implementation
**Before:** `index.ts` registers or supplies callback implementations, bridge handlers, and permission fallback behavior.
**After:** (removed) — Rust owns all registration and permission behavior; `index.ts` only loads WASM and performs the single Pi handoff.

## 17. Acceptance criteria
```gherkin
Scenario: Loader hands Pi to Rust once
  Given Pi loads tool-permissions
  When index.ts executes
  Then it loads the native module
  And performs one Rust initialization handoff
  And it implements no permission callback behavior

Scenario: Missing WASM fails closed
  Given the WASM artifact is unavailable or invalid
  When a tool authorization would occur
  Then the extension reports native-engine failure
  And it does not authorize the tool
```

## 18. Out of scope
Deleting `index.ts`, changing Pi package discovery, or porting other extensions.

## 19. Risks
Deleting the bridge can leave hidden test-only imports or callback helpers. Structural tests and full extension tests must gate completion.

## 20. Implementation steps
1. Add a structural contract that index.ts has only module loading and Rust initialization handoff responsibilities → verify: `npm test -- extensions/tool-permissions`
2. Remove remaining TypeScript callback registration, bridge, behavior, and fallback paths → verify: `npm run check`
3. Verify unavailable or invalid WASM cannot authorize a tool → verify: `npm test -- extensions/tool-permissions`

## Verification script
1. Run the full tool-permissions test suite.
2. Inspect the entrypoint against the structural contract.
3. Temporarily use an invalid native package in the native-unavailable test fixture and confirm authorization is denied.
