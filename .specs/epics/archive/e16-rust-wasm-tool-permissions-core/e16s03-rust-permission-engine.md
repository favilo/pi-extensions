# e16s03 — Port Bash permission evaluation to a Rust/WASM core

## 1. Identity
- **Story:** e16s03
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 4
- **Risk:** P0
- **Delta:** ADDED

## 2. User need
Users need the Bash authorization boundary to keep its exact deny-first, fail-closed behavior while moving rule evaluation into a more isolated Rust/WASM core.

## 3. Goal
Port the pure decision logic for Bash subcommand permission evaluation to Rust/WASM while preserving current allow, deny, ask, and unsupported outcomes, denied-subcommand details, and audit-ready evaluated components.

## 4. Non-goals
- Changing the TOML policy schema.
- Replacing TypeScript-owned prompt UI, audit writes, or saved-rule persistence.
- Altering the semantics of read/write or non-Bash tool families in this story.

## 5. Users
Pi users relying on Bash permission rules and maintainers of the `tool-permissions` security boundary.

## 6. User journey
An agent submits a Bash command. After parsing, the host sends normalized subcommands and configured rules to the Rust/WASM evaluator. The evaluator returns the same decision class and denial detail the TypeScript implementation would have returned, so the user sees unchanged prompts and outcomes.

## 7. Preconditions
- e16s02 established parser parity.
- Existing policy-matching behavior is covered by executable tests and audit expectations.

## 8. Inputs
Normalized subcommand units, Bash allow/deny rules, current working directory, and any metadata required for audit-ready decision output.

## 9. Outputs
Structured decision results: allow, deny, ask, or unsupported/error, with denied-subcommand details and evaluated-component metadata.

## 10. Requirements
- ADDED: The Rust/WASM evaluator shall preserve existing rule semantics: fields within one rule are ANDed, rules in a list are ORed, and deny takes precedence over allow.
- ADDED: Whole-command authorization shall remain atomic: one denied or unsupported component denies the complete invocation.
- ADDED: Agent-facing denial details shall continue to identify the denied or unsupported subcommand without leaking unrelated policy configuration.
- ADDED: The host shall validate all evaluator output and fail closed to a denial if the module returns an invalid shape, incompatible version, or runtime error.

## 11. Quality attributes
Security parity, fail-closed behavior, deterministic evaluation, and minimal trusted host surface.

## 12. Interfaces and contracts
TypeScript remains the owner of policy loading, prompt orchestration, and audit writes. Rust/WASM owns only pure Bash decision evaluation over validated inputs and returns structured data the host revalidates.

## 13. State
No persistent module state. Decisions are per invocation.

## 14. Dependencies
- e16s01 and e16s02.
- Existing `extensions/tool-permissions/bash-subcommands.ts` and policy-matching tests.
- A threat model for the host/module boundary and fail-closed semantics.

## 15. Failure modes
Silent allow on invalid output, mismatched rule precedence, loss of denied-subcommand detail, drift between parser and evaluator assumptions, or audit gaps from missing evaluated-component data.

## 16. Observability
Tests and audit fixtures shall capture both the terminal decision and the per-component metadata used to explain or log denials.

## 17. Acceptance criteria
### Scenario: Deny still wins atomically
**Given** a compound command where one subcommand matches a deny rule
**When** the Rust/WASM evaluator authorizes it
**Then** the whole command is denied and the denied subcommand is identified.

### Scenario: Ask remains the fallback
**Given** a compound command where no component matches a deny rule and at least one component matches no allow rule
**When** the Rust/WASM evaluator authorizes it
**Then** the result is ask and no component executes.

### Scenario: Invalid module output fails closed
**Given** the host receives an invalid or incompatible result from the Rust/WASM evaluator
**When** authorization runs
**Then** the host denies the invocation and does not continue on a partially trusted result.

## 18. Automated verification
- `node --test extensions/tool-permissions/bash-subcommands.test.ts`
- `node --test extensions/tool-permissions/wasm-decision-engine.test.ts`
- `node --test extensions/tool-permissions/permission-boundary.test.ts`
- `npm run check`

## 19. Implementation steps
1. Add failing parity tests for rule precedence, atomic deny, ask fallback, denied-subcommand details, and invalid-module-output handling.
2. Implement the Rust/WASM evaluator and structured decision schema.
3. Route Bash authorization through the validated WASM evaluator while preserving current prompt and audit behavior.
4. Re-run the threat model and security review inputs before marking the story passing.

## 20. Definition of done
Rust/WASM Bash decision evaluation preserves the current security contract, and every host/module failure path denies rather than widens access.
