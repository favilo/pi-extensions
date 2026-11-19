## Target

`extensions/tool-permissions/index.ts`, `native-registration-loader.ts`, and the Rust `pi-api`/`tool-permissions-native` registration boundary. The modules register Pi callbacks and currently forward callback behavior through a TypeScript bridge.

## Dependents (7)

- `extensions/tool-permissions/index.ts`: constructs TypeScript bridge handlers and invokes native registration.
- `extensions/tool-permissions/native-registration-loader.ts`: validates native registration contracts and passes Pi plus the bridge object.
- `extensions/tool-permissions/native-registration.test.ts`: exercises registration loading, contract validation, and callback forwarding.
- `extensions/tool-permissions/native-no-typescript-fallback.test.ts`: verifies failure behavior when native registration is unavailable or invalid.
- `extensions/tool-permissions/index.test.ts`: stubs native registration during extension integration tests.
- `extensions/tool-permissions/native/crates/tool-permissions-native/src/registration.rs`: registers event, command, and renderer callbacks.
- `extensions/tool-permissions/native/crates/pi-api/src/bridge.rs`: provides the TypeScript bridge forwarding mechanism.

## Affected Stories

- e18s06: cancelled; its remaining TypeScript fallback removal work is resliced into e19.
- e18s07: cancelled; its Miri prompt queue proof moves to e19s02.
- e19s01: safe Rust callback lifetime and dispatch proof.
- e19s02: Miri prompt queue FunctionRef lifetime validation.
- e19s03: direct Rust Pi registration without TypeScript bridge lookup.
- e19s04: Rust lifecycle and tool authorization orchestration.
- e19s05: Rust interactive permission surfaces.
- e19s06: loader-only TypeScript entrypoint.

## Test Coverage

- `extensions/tool-permissions/native-registration.test.ts`: native registration request/response contracts, callback registration, and forwarding behavior.
- `extensions/tool-permissions/native-no-typescript-fallback.test.ts`: unavailable/invalid native registration failure behavior.
- `extensions/tool-permissions/index.test.ts`: extension startup integration and registration stubs.
- `extensions/tool-permissions/native-path-trust.test.ts`: fail-closed native host contract behavior.
- Gap: no native integration test proves a Rust-created callback survives initialization and safely dispatches without a TypeScript bridge.
- Gap: no Miri evidence exists for the prompt queue FunctionRef lifetime pattern.

## Risk: High

This changes a shared extension host boundary across TypeScript, NAPI/WASM, and Pi callbacks. It has security-sensitive authorization behavior and multiple existing callers/tests.

## Recommended action

Proceed only in vertical slices: first prove safe Rust callback lifetime and dispatch, then run the Miri proof, then replace bridge forwarding behind parity tests. Keep TypeScript loader behavior until all callback classes have migrated.
