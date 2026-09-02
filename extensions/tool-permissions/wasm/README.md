# tool-permissions WASM probe

This crate is an exploratory, pure-computation probe for the TypeScript host.

Build the JS-hosted artifact with the installed Rust target:

```sh
cargo build --manifest-path extensions/tool-permissions/wasm/Cargo.toml \
  --target wasm32-unknown-unknown --release
```

The initial boundary uses `wasm-bindgen` with `serde-wasm-bindgen` to exchange
structured JavaScript values. Rust accepts a deserialized `ProbeRequest` and
returns a serialized `ProbeResponse`. The TypeScript host remains authoritative
and validates the versioned contract; any artifact, runtime, or decode failure
falls back to TypeScript.

`pi-oxidized` is a Rust rewrite of the broader Pi runtime, so adopting it
would expand this spike's scope and runtime coupling. Its `pi-oxidized-ext`
(`pi_ext`) bridge remains an open compatibility experiment; it is not yet a
dependency of this narrow probe. NAPI-RS documents `wasm32-wasip1-threads` as its supported WASI fallback
target. This crate compiles for that target, but the current wasm-bindgen
pipeline cannot prepare the threaded artifact (`__heap_base` is unavailable),
and direct Node loading requires the `wasi_snapshot_preview1` host import.
The next experiment is an napi-rs/`@emnapi`-style package/runtime adapter;
WASI Preview 1/2 is not enabled in the production loader until that adapter is
validated.

The module has no shell, filesystem, network, or permission-decision APIs.
