# e16s04 — Integrate the Rust/WASM core with packaging, fallback, and docs

## 1. Identity
- **Story:** e16s04
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 3
- **Risk:** P1
- **Delta:** ADDED

## 2. User need
Maintainers need the hybrid extension to build, test, package, and diagnose cleanly so the Rust/WASM path can ship without making normal Pi package use fragile.

## 3. Goal
Finish runtime selection, packaging, CI coverage, and maintainer documentation for the hybrid TypeScript plus Rust/WASM `tool-permissions` extension.

## 4. Non-goals
- Porting unrelated extensions to Rust.
- Changing end-user permission UX beyond surfacing the active engine and safe fallback warnings.

## 5. Users
Maintainers, release owners, and advanced users diagnosing hybrid-extension startup.

## 6. User journey
A maintainer clones the repo, runs the documented build, and gets the correct artifact layout. A user starts Pi and the extension either uses the Rust/WASM core or clearly reports a fallback to TypeScript without changing user-facing permission semantics.

## 7. Preconditions
- e16s01 through e16s03 are complete.
- The hybrid runtime path is already functionally correct.

## 8. Inputs
Package manifests, build scripts, CI commands, generated artifacts, and runtime capability/compatibility signals.

## 9. Outputs
Repeatable build steps, checked verification coverage, packaged artifact inclusion, documented maintenance workflow, and deterministic runtime fallback behavior.

## 10. Requirements
- ADDED: The package shall build and include the required WASM artifact(s) in a repeatable way for local development and packaged installation.
- ADDED: Runtime selection shall be deterministic: use the validated Rust/WASM core when compatible, otherwise fall back to the existing TypeScript core with visible maintainer-facing diagnostics.
- ADDED: Prompt rendering, saved-rule flows, audit records, and existing non-Bash permission paths shall remain behaviorally unchanged by the migration.
- ADDED: Repo documentation shall describe toolchain prerequisites, local build/test commands, packaging expectations, and the supported fallback behavior.

## 11. Quality attributes
Operational clarity, reproducible packaging, maintainability, and low regression risk.

## 12. Interfaces and contracts
The extension exports the same Pi-facing commands, tools, and prompts. Runtime engine selection is an internal implementation detail with explicit diagnostics for maintainers.

## 13. State
No new user configuration is required unless a maintainer explicitly opts into diagnostics.

## 14. Dependencies
- e16s01 through e16s03.
- `package.json`, lockfiles, CI scripts, and package docs.

## 15. Failure modes
Artifact omitted from package output, CI verifying only one engine, noisy or missing fallback diagnostics, or accidental behavior drift outside Bash authorization.

## 16. Observability
Verification should record which engine was active for relevant tests and whether fallback was intentional or error-driven.

## 17. Acceptance criteria
### Scenario: Packaged install includes the WASM core
**Given** a fresh local or packaged install
**When** the extension loads
**Then** the expected artifact is present and the runtime can select it.

### Scenario: Fallback stays truthful
**Given** the Rust/WASM core cannot load
**When** Pi starts the extension
**Then** the extension uses the TypeScript implementation and reports the fallback without pretending the Rust/WASM path is active.

### Scenario: Existing UX stays stable
**Given** a user performs existing permission flows
**When** the hybrid extension is active
**Then** prompts, rule persistence, history rendering, and audits behave as before.

## 18. Automated verification
- `node --test extensions/tool-permissions/index.test.ts`
- `node --test extensions/tool-permissions/documentation.test.ts`
- `npm run check:ci`

## 19. Implementation steps
1. Add failing integration tests for engine selection, truthful fallback diagnostics, and unchanged user-visible permission flows.
2. Wire build and packaging steps for the Rust/WASM artifact.
3. Update repo documentation and maintainer workflow notes.
4. Run the complete package suite and backlog-plan consistency checks.

## 20. Definition of done
The hybrid `tool-permissions` extension can be built and packaged repeatably, falls back safely, and preserves the current Pi-facing UX.
