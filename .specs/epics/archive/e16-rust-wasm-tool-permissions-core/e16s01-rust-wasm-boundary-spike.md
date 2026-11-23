# e16s01 — Spike a supported Rust/WASM boundary for tool-permissions

## 1. Identity
- **Story:** e16s01
- **Type:** spike
- **Maturity:** 3 — Countable
- **BCPs:** 3
- **Risk:** P1
- **Delta:** ADDED

## 2. User need
Maintainers need a small, supported Rust/WASM pilot before moving production permission logic so the repo does not commit to an unsupported packaging or runtime shape.

## 3. Goal
Prove a minimal Rust/WASM core can be loaded from this package, exchange versioned structured data with the existing TypeScript extension, and fail closed when the artifact or contract is invalid.

## 4. Non-goals
- Porting production parser or policy logic yet.
- Replacing the existing TypeScript implementation in this story.
- Introducing a second permission decision path.

## 5. Users
Maintainers of `extensions/tool-permissions/` and future Pi package authors evaluating Rust/WASM delivery.

## 6. User journey
A maintainer builds the package, starts Pi, and sees the extension load a minimal Rust/WASM core through a narrow host adapter. If the artifact is missing, incompatible, or disabled, the extension warns and continues on the existing TypeScript path.

## 7. Preconditions
- The current TypeScript `tool-permissions` extension remains the production path.
- The repo can add Rust build tooling without changing existing TypeScript startup semantics.

## 8. Inputs
Package layout, Rust crate source, built WASM artifact, host loader configuration, ABI/version handshake data, and the existing TypeScript extension runtime.

## 9. Outputs
A documented package layout, a versioned host/module contract, a minimal loadable WASM artifact, and deterministic fallback behavior.

## 10. Requirements
- ADDED: Define one narrow, versioned structured-data contract between the TypeScript host and the Rust/WASM module.
- ADDED: Evaluate `pi-oxided` as the preferred Rust-side boundary if it supports the required package and runtime shape; otherwise document the constraint and adopt the smallest supported alternative.
- ADDED: Loading, initialization, version mismatch, decode failure, or panic-like module failure must fail closed to the existing TypeScript path and never silently auto-allow a permissioned action.
- ADDED: The probe must avoid direct shell, filesystem mutation, or tool execution from Rust/WASM; it is a pure contract spike.

## 11. Quality attributes
Deterministic startup, explicit fallback, replaceable boundary, reproducible packaging, and low operational risk.

## 12. Interfaces and contracts
The host owns artifact discovery, runtime selection, output validation, and fallback. The module exposes only a small versioned health/echo-style contract returning structured values the host validates before use.

## 13. State
No user-visible runtime state changes. Build artifacts are generated from checked-in source.

## 14. Dependencies
- `extensions/tool-permissions/` current TypeScript runtime.
- Pi package loading behavior documented in `docs/extensions.md`.
- Rust/WASM toolchain and any approved crate-level bridge such as `pi-oxided`.

## 15. Failure modes
Missing artifact, incompatible ABI version, host/module shape drift, startup-only success with runtime failure later, or silent fallback without observability.

## 16. Observability
Interactive sessions should surface whether the WASM probe loaded or whether the extension fell back to TypeScript. Tests must assert the active path deterministically.

## 17. Acceptance criteria
### Scenario: Supported artifact loads
**Given** a compatible built WASM artifact
**When** the extension initializes its host adapter
**Then** the version handshake succeeds and the host can call the minimal structured contract.

### Scenario: Incompatible artifact fails closed
**Given** a missing or incompatible WASM artifact
**When** the extension initializes
**Then** it falls back to the existing TypeScript path without executing any permissioned action through the broken boundary.

### Scenario: Unsupported `pi-oxided` path is documented
**Given** `pi-oxided` cannot satisfy the required package/runtime shape
**When** the spike completes
**Then** the repo records the specific constraint and the chosen narrow fallback boundary.

## 18. Automated verification
- `node --test extensions/tool-permissions/wasm-loader.test.ts`
- `node --test extensions/tool-permissions/wasm-contract.test.ts`
- `npm run check`

## 19. Implementation steps
1. Add failing host-loader contracts for artifact discovery, version handshake, and fallback behavior.
2. Stand up the Rust crate, build output location, and minimal module contract.
3. Implement the TypeScript host adapter and validated fallback path.
4. Document the selected boundary, including whether `pi-oxided` was viable.

## 20. Definition of done
The repo has a proven, documented Rust/WASM packaging boundary for `tool-permissions`, and all failure paths fall back safely to the existing TypeScript implementation.
