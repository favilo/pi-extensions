# e16s02 — Port Bash parsing to a Rust/WASM core

## 1. Identity
- **Story:** e16s02
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 4
- **Risk:** P1
- **Delta:** ADDED

## 2. User need
Users need the Bash subcommand parser to retain current safe behavior while moving pure parsing work into a more constrained, testable Rust/WASM core.

## 3. Goal
Port command-unit extraction and recursive Bash subcommand parsing from TypeScript to Rust/WASM with golden parity on supported syntax and identical fail-closed behavior on unsupported syntax.

## 4. Non-goals
- Rewriting prompt UI, audit logging, or permission persistence.
- Expanding supported syntax beyond the current TypeScript contracts.

## 5. Users
Users subject to Bash permission prompts and maintainers of the `tool-permissions` parsing code.

## 6. User journey
An agent submits a Bash command. The extension uses the Rust/WASM parser to normalize subcommands and source spans. Existing prompts and decisions behave the same as before because the returned parse structure matches the TypeScript contract.

## 7. Preconditions
- e16s01 established the loadable host/module boundary.
- The current TypeScript parser corpus remains available as the parity oracle.

## 8. Inputs
Raw Bash command strings and any existing parser options required by the current subcommand extraction logic.

## 9. Outputs
Structured subcommand units, source spans, unsupported-syntax diagnostics, and parity evidence against the current TypeScript behavior.

## 10. Requirements
- ADDED: The Rust/WASM parser shall produce the same extracted subcommands and source spans as the current TypeScript parser for the approved corpus.
- ADDED: Recursive extraction for command substitutions, subshells, brace groups, pipelines, and compound lists shall preserve current behavior.
- ADDED: Unsupported syntax, dynamic expansion, and parse errors shall fail closed with the same agent-facing class of denial as today.
- ADDED: The Rust/WASM parser shall remain pure and shall not execute shell text, inspect the filesystem, or resolve environment variables.

## 11. Quality attributes
Behavioral parity, deterministic error handling, bounded output, and isolated pure computation.

## 12. Interfaces and contracts
The host supplies raw command text and receives structured parse results or a structured unsupported/error result. The host validates the returned shape before reusing it in existing permission flows.

## 13. State
No persistent state. Parser results are per-invocation.

## 14. Dependencies
- e16s01 host/module boundary.
- Existing `extensions/tool-permissions/bash-parser.ts` contracts and tests.

## 15. Failure modes
Incorrect source spans, missed inner subcommands, broader syntax support than intended, parser panics, or error messages that stop matching existing denial flows.

## 16. Observability
Parity tests must identify the exact command corpus case that diverges and whether the mismatch is extraction, source span, or unsupported-syntax classification.

## 17. Acceptance criteria
### Scenario: Compound command parity
**Given** a command containing `&&`, `||`, `;`, and pipelines
**When** it is parsed through the Rust/WASM core
**Then** the extracted subcommands match the current TypeScript behavior.

### Scenario: Recursive substitution parity
**Given** a command containing `$(...)`, backticks, or subshells
**When** it is parsed through the Rust/WASM core
**Then** inner subcommands and source spans match the current TypeScript behavior.

### Scenario: Unsupported syntax stays fail-closed
**Given** a command using unsupported or dynamic syntax
**When** the Rust/WASM parser evaluates it
**Then** the result remains a fail-closed unsupported/error outcome.

## 18. Automated verification
- `node --test extensions/tool-permissions/bash-parser.test.ts`
- `node --test extensions/tool-permissions/wasm-parser-parity.test.ts`
- `node --test extensions/tool-permissions/bash-subcommands.test.ts`
- `npm run check`

## 19. Implementation steps
1. Add parity fixtures and failing tests that run both implementations over the same corpus.
2. Implement the Rust/WASM parser and structured result encoding.
3. Route the host parser adapter through the WASM path while preserving TypeScript fallback.
4. Remove duplicated TypeScript-only parsing paths only after parity is green.

## 20. Definition of done
Rust/WASM parsing matches the current Bash parsing contracts on the approved corpus and preserves current fail-closed behavior for unsupported input.
