# tool-permissions WASM probe

This crate is an exploratory, pure-computation probe for the TypeScript host.

Build the JS-hosted artifact with the installed Rust target:

```sh
cargo build --manifest-path extensions/tool-permissions/wasm/Cargo.toml \
  --target wasm32-unknown-unknown --release
```

The initial boundary uses `wasm-bindgen` with a JSON request/response string.
The TypeScript host remains authoritative and validates the versioned contract;
any artifact, runtime, or decode failure falls back to TypeScript.

`pi-oxidized` is a Rust rewrite of the broader Pi runtime, so adopting it
would expand this spike's scope and runtime coupling. Its `pi-oxidized-ext`
(`pi_ext`) bridge remains an open compatibility experiment; it is not yet a
dependency of this narrow probe. WASI Preview 1/2 remains a separate
experiment because it requires a different Node adapter and packaging shape.

The module has no shell, filesystem, network, or permission-decision APIs.
