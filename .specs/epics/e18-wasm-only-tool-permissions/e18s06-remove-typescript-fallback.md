# e18s06 — Remove the TypeScript permission fallback

## 1. Identity
- **Story:** e18s06
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 3
- **Risk:** P0
- **Delta:** REMOVED

## 2. User need
A TypeScript permission implementation can still authorize a tool call when WASM fails. That second engine can drift from the WASM engine and hide a broken artifact.

## 3. Goal
The extension authorizes tool calls only through the WASM runtime. `extensions/tool-permissions/index.ts` only loads that module. A missing, invalid, or failed module denies the call and reports the failure.

## 4. Non-goals
- Deleting `extensions/tool-permissions/index.ts`. Pi loads the package through that entry.
- Porting another extension.
- Changing allow, deny, prompt, audit, or save behavior on the WASM success path.
- Rewriting passing e16 stories. This story supersedes their fallback requirements for new work.

## 5. Users
Maintainers who need one runtime, and users who must not get a silent second permission engine.

## 6. User journey
Pi starts and loads `index.ts`. That file instantiates the WASM module and registers the extension through it. If the artifact is missing or the module fails, Pi reports the failure and the extension does not allow a tool call.

## 7. Preconditions
- e18s01 through e18s05 are passing, so path trust, audit writes, rule saves, prompts, and execution have WASM owners.
- e18s00 has recorded adopt or reject for `pi-oxidized-ext`. This story uses that host.
- The current package still builds `wasm32-wasip1-threads` with flavor `wasm32-wasi`.

## 8. Inputs
The built WASM artifact, package entry, and a tool request used to prove failure behavior.

## 9. Outputs
A loader-only TypeScript entry. Startup diagnostics that name WASM as the only engine. A closed failure when that engine is unavailable.

## 10. Requirements
#### REMOVED: TypeScript permission fallback
**Before:** e16s01, e16s04, e16s05, and e16s07 require a missing or failed native module to fall back to the TypeScript permission implementation.
**After:** That fallback is gone. The same failures deny the tool call and report that WASM did not load. No TypeScript permission engine runs.

#### ADDED: The package entry only loads WASM
`extensions/tool-permissions/index.ts` instantiates the WASM module and does not contain prompt, policy, audit, trust, or execution logic.

## 11. Quality attributes
One engine, truthful diagnostics, and fail closed.

## 12. Interfaces and contracts
The NAPI package remains `wasm32-wasip1-threads` with flavor `wasm32-wasi`. The loader reads the existing generated artifact. It does not select `wasm32-unknown-unknown`.

## 13. State
No new persistent state. Existing `permissions.toml` files and audit logs stay in place.

## 14. Dependencies
- e18s01 through e18s05.
- Current `build:native` output and `scripts/patch-wasi-init-tp.mjs`.
- `.specs/security/epics/e18/THREAT_MODEL.md` threat 7.

## 15. Failure modes
A missing artifact still allows through TypeScript. Diagnostics claim WASM is active while another engine ran. The loader file grows back into a permission implementation.

## 16. Observability
Startup diagnostics name the WASM artifact. Failure diagnostics name the load error and state that no alternate engine ran.

## 17. Acceptance criteria
### Scenario: Startup uses WASM only
**Given** a built WASM artifact
**When** Pi loads the extension
**Then** diagnostics name that artifact and the TypeScript entry does not register a second permission engine.

### Scenario: Missing WASM fails closed
**Given** no usable WASM artifact, or a module that fails its version check
**When** a protected tool is requested
**Then** the request is denied, the failure is reported, and no TypeScript permission implementation allows it.

## 18. Automated verification
- `node --test extensions/tool-permissions/native-no-typescript-fallback.test.ts extensions/tool-permissions/native-package.test.ts`
- `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml`
- `npm run build:native && npm run check`

## 19. Implementation steps
1. Add failing tests that deny protected calls when the artifact is missing or invalid and that reject a TypeScript engine selection. → verify: `node --test extensions/tool-permissions/native-no-typescript-fallback.test.ts extensions/tool-permissions/native-package.test.ts`
2. Remove success-path and load-failure branches that authorize through TypeScript. → verify: `node --test extensions/tool-permissions/native-no-typescript-fallback.test.ts`
3. Reduce `extensions/tool-permissions/index.ts` to WASM instantiation and registration. → verify: `node --test extensions/tool-permissions/native-no-typescript-fallback.test.ts extensions/tool-permissions/native-package.test.ts`
4. Run the native build and full checks. No new security findings in affected paths. → verify: `npm run build:native && npm run check`

## 20. Definition of done
The extension has one permission engine. The TypeScript file only loads WASM. A missing or invalid module cannot authorize a tool call.
