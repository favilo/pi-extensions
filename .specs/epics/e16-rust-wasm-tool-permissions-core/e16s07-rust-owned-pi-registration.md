# e16s07 — Register Pi tool-permissions callbacks from Rust

## 1. Identity
- **Story:** e16s07
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 5
- **Risk:** P1
- **Delta:** ADDED

## 2. User need
Maintainers want to explore a thinner TypeScript shim where Rust owns more extension assembly, including registering Pi `on` callbacks and commands, while preserving the existing permission boundary and host-controlled side effects.

## 3. Goal
Introduce a Rust-owned registration adapter that can register the tool-permissions Pi callbacks through the NAPI package, starting with safe lifecycle and diagnostic callbacks before migrating request handlers.

## 4. Non-goals
- Full Pi runtime rewrite.
- Exposing raw ExtensionAPI capabilities to arbitrary native code.
- Moving prompt rendering, TUI editing, filesystem trust, audit file writes, or tool execution into Rust in this story.

## 5. Users
Maintainers evaluating how far native extension assembly can move while keeping Pi package behavior stable.

## 6. User journey
A maintainer enables the Rust registration experiment. The TypeScript entrypoint loads the bundled native package, passes the Pi registration host to Rust, and Rust calls `pi.on` to register safe session callback hooks before progressively migrating additional extension assembly. If the native registration fails or is disabled, TypeScript registration remains the safe default.

## 7. Preconditions
- e16s04 production native selection is complete.
- e16s06 identifies which permission computations can safely move behind native operations.
- Pi extension API callback semantics are documented and covered by tests.

## 8. Inputs
A Pi registration host exposing `pi.on` for lifecycle registration, native registration contract metadata, and existing callback fixtures.

## 9. Outputs
A versioned native registration operation, a minimal TypeScript fallback shim, parity tests for registered callbacks, and diagnostics identifying TypeScript-vs-Rust registration mode.

## 10. Requirements
- ADDED: Rust registration shall call `pi.on` directly through the host-supplied Pi registration object.
- ADDED: Native-registered callbacks shall preserve event names, ordering assumptions, prompt behavior, command registration behavior, and shutdown cleanup semantics.
- ADDED: Registration failures, missing exports, version mismatches, or callback panics shall fall back to the TypeScript registration path without dropping the permission boundary.
- ADDED: The first native registration slice shall be lifecycle/diagnostic-only unless tests prove request-handling parity and fallback safety.

## 11. Quality attributes
Incremental migration, API containment, deterministic fallback, and observable runtime mode.

## 12. Interfaces and contracts
TypeScript calls a versioned native registration export with the Pi registration host. Rust invokes `pi.on` directly to register callbacks. Callback bodies may delegate back through validated host services for prompts, filesystem, audit, and execution until those responsibilities are explicitly ported in later stories.

## 13. State
Native registration state is process-local and torn down through existing Pi lifecycle hooks. Persistent user state remains TypeScript-owned.

## 14. Dependencies
- Native bundled loader and contract validation.
- Existing extension registration tests in `extensions/tool-permissions/index.test.ts` and permission-boundary tests.
- Pi extension API documentation for callback registration semantics.

## 15. Failure modes
Native code receives more Pi authority than intended, callbacks are double-registered, fallback leaves no permission hook installed, callback ordering changes prompt behavior, or shutdown cleanup diverges.

## 16. Observability
Startup diagnostics shall report registration mode. Tests shall assert exact registered event names, command names, fallback reason, and that no duplicate callback path is active.

## 17. Acceptance criteria
### Scenario: Rust registers lifecycle callbacks
**Given** the native registration experiment is enabled and the native package is compatible
**When** tool-permissions initializes
**Then** Rust registers the expected lifecycle callbacks through `pi.on` and diagnostics report Rust registration.

### Scenario: Registration failure falls back safely
**Given** native registration is missing, incompatible, or throws
**When** tool-permissions initializes
**Then** TypeScript registers the permission boundary callbacks exactly once and diagnostics report fallback.

### Scenario: Request handling parity is preserved
**Given** native registration owns an eligible callback
**When** protected tool requests and session lifecycle events run
**Then** prompt, audit, saved-rule, and denial behavior match the TypeScript registration path.

## 18. Automated verification
- `node --test extensions/tool-permissions/index.test.ts extensions/tool-permissions/native-registration.test.ts extensions/tool-permissions/permission-boundary.test.ts`
- `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml`
- `npm run check`

## 19. Implementation steps
1. Read the Pi extension callback API docs and add RED tests for a constrained native registration facade.
2. Add a native registration contract/export that registers lifecycle diagnostics through the facade.
3. Add fallback and duplicate-registration protections around TypeScript-vs-Rust registration selection.
4. Incrementally migrate eligible tool-permission callbacks only after parity and fallback tests are green.
5. Run full package and plan checks.

## 20. Definition of done
The extension can experimentally register Pi callbacks from Rust through direct `pi.on` calls behind a versioned native contract, with TypeScript fallback preserving the permission boundary and user-facing behavior.
