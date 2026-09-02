# e16s05 — Establish a native NAPI-RS Node package for tool-permissions

## 1. Identity
- **Story:** e16s05
- **Type:** spike
- **Maturity:** 3 — Countable
- **BCPs:** 4
- **Risk:** P0
- **Delta:** ADDED

## 2. User need
Maintainers need a supported native Rust Node package boundary so permission computation can move out of TypeScript without coupling the Pi extension to a full Rust rewrite.

## 3. Goal
Prove that a standalone NAPI-RS package can expose typed, pure tool-permissions computation to the existing Pi extension, with a minimal JavaScript registration shim and a safe TypeScript fallback.

## 4. Non-goals
- Replacing Pi's JavaScript/TypeScript ExtensionAPI registration surface.
- Porting the complete Bash parser or permission engine in this story.
- Adopting `pi-oxidized` or `pi-oxidized-ext` as the extension runtime.
- Enabling native computation before parity and package smoke tests pass.

## 5. Users
Tool-permissions maintainers and Pi package authors evaluating native Rust extensions.

## 6. User journey
A maintainer builds the native package, runs its contract tests, and loads the existing extension. The JS shim registers Pi hooks, the native package is selected only when compatible, and all invalid or missing native paths remain on the TypeScript implementation.

## 7. Preconditions
- e16s01 established a versioned structured contract and fail-safe fallback.
- The current TypeScript permission boundary remains authoritative.
- Pi continues to load extensions through its JavaScript/TypeScript package entries.

## 8. Inputs
Bounded structured permission-engine requests, native package artifacts, package metadata, and the existing Pi extension runtime.

## 9. Outputs
A standalone NAPI-RS crate/package layout, typed native contract, host loader, fallback behavior, and documented package smoke evidence.

## 10. Requirements
- ADDED: Rust shall own only pure computation behind the native package boundary; prompts, policy persistence, audit writes, filesystem access, and tool execution remain host-owned.
- ADDED: The native package shall expose a versioned structured request/response contract with bounded inputs and outputs.
- ADDED: A minimal JS shim shall register Pi hooks while delegating only validated computation to the native package.
- ADDED: Missing artifacts, package-load errors, version mismatches, invalid output, panics, or inconsistent aggregate decisions shall fall back to the existing TypeScript path and never auto-allow.
- ADDED: Native and WASI package selection shall be explicit and observable; artifact presence alone shall not claim that native computation is active.
- ADDED: The package layout shall support `npm pack --dry-run` without requiring consumers to install a Rust toolchain.

## 11. Quality attributes
Native runtime isolation, deterministic fallback, reproducible packaging, typed boundaries, and low migration risk.

## 12. Interfaces and contracts
The Pi-facing extension API remains unchanged. The native package receives validated structured data and returns a validated decision/result object including contract version and engine identity. The host owns runtime selection and fallback.

## 13. State
No persistent native-module state and no user-visible permission configuration changes.

## 14. Dependencies
- e16s01 contract and fallback.
- Existing `index.ts`, `bash-subcommands.ts`, and permission boundary tests.
- NAPI-RS CLI/package tooling `[OK]` and `@emnapi` WASI runtime support `[OK]`, subject to package-shape verification.

## 15. Failure modes
Native package omitted from the published package, ABI/runtime mismatch, unsafe output accepted by the host, JS shim bypassing the permission boundary, or native and TypeScript results diverging.

## 16. Observability
Tests and startup diagnostics identify the selected engine, package artifact, contract version, and fallback reason without exposing policy secrets.

## 17. Acceptance criteria
### Scenario: Native package loads through the shim
**Given** a compatible NAPI-RS package
**When** the extension initializes its host adapter
**Then** the JS shim can call the typed native contract and reports the native engine truthfully.

### Scenario: Native package failure falls back safely
**Given** a missing, incompatible, or throwing native package
**When** the extension initializes or evaluates a request
**Then** it uses the TypeScript path and never treats the failed native result as an allow.

### Scenario: Package is directly consumable
**Given** a clean checkout without a Rust toolchain on the consumer machine
**When** the package is built and packed
**Then** `npm pack --dry-run` includes the generated native/WASI loader artifacts and JS entrypoint required by the package manifest.

## 18. Automated verification
- `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml`
- `npm run build:native`
- `node --test extensions/tool-permissions/native-loader.test.ts extensions/tool-permissions/native-contract.test.ts`
- `npm run check`
- `npm pack --dry-run`

## 19. Implementation steps
1. Scaffold the standalone NAPI-RS crate, package manifest, generated-loader location, and minimal typed native probe → verify: `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml`
2. Add failing host contract tests for native loading, version/output validation, engine identity, and fail-safe fallback → verify: `node --test extensions/tool-permissions/native-loader.test.ts extensions/tool-permissions/native-contract.test.ts`
3. Implement the JS host adapter and minimal Pi registration seam without moving prompts, audit, persistence, or execution into Rust → verify: `node --test extensions/tool-permissions/native-loader.test.ts extensions/tool-permissions/native-contract.test.ts extensions/tool-permissions/permission-boundary.test.ts`
4. Add native/WASI build and package scripts, then document the package/runtime matrix and `pi_ext` comparison → verify: `npm run build:native && npm pack --dry-run ./extensions/tool-permissions/native`
5. Run the full package gates and confirm existing permission behavior remains green → verify: `npm run check`

## 20. Definition of done
A native Rust Node package can be built and consumed through a minimal Pi JS shim, all host/module failures fall back safely, and package smoke evidence proves the artifact is directly distributable.

## Verification Script (Step-by-Step)
1. Run the documented native build command from a clean checkout.
2. Run the native contract and loader tests.
3. Run `npm pack --dry-run` and confirm the package contains the JS shim, native loader, and generated runtime artifacts.
4. Start Pi with the native package available and confirm the startup diagnostic identifies the native engine.
5. Remove or invalidate the native artifact and restart Pi; confirm the diagnostic identifies TypeScript fallback and no permissioned action is auto-allowed through the failed path.

## Out of scope
- Full Rust parser/evaluator parity, covered by e16s02 and e16s03.
- Full Pi runtime rewrite or adoption of `pi-oxidized`.
- Native implementation of prompt UI, audit persistence, policy loading, or tool execution.

## Risks
- NAPI-RS generated package shape may not match Pi package loading; detect with `npm pack --dry-run` and a clean consumer smoke test.
- WASI fallback may require `@emnapi` host support; keep it explicit and fail closed until loaded through Node successfully.
- Native/TypeScript drift can widen authorization; require parity fixtures before routing production decisions.
