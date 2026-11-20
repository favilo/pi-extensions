# e18s00 pi-oxidized decision

decision: reject
pi-oxidized: 0.1.1
pi-oxidized-ext: 0.1.1
blocking constraint: pi-oxidized-ext 0.1.1 is a Bun JSONL host client (crate import `pi_ext`). It does not wrap the Node ExtensionAPI, so Rust cannot register `pi.on`, `registerCommand`, or `registerEntryRenderer` through it. Adopting it would add a second runtime beside the current `wasm32-wasip1-threads` NAPI package (flavor `wasm32-wasi`).
alternative: pi-api

## Probe

`cargo info` reports crates.io releases `pi-oxidized` 0.1.1 and `pi-oxidized-ext` 0.1.1 (`rust-version` 1.97.1, repository https://github.com/metaphorics/pi-oxided). `pi-oxidized` is the product runtime. `pi-oxidized-ext` is the extension-host protocol and TypeScript plugin bridge. It launches a Bun host (`PI_EXTENSION_HOST` or a sibling `pi-extension-host`) and speaks JSONL. `HostClient` can send lifecycle method strings such as `tool_call` to that host. `Registry::register_tool` stores metadata for a TypeScript-hosted tool. There is no API that registers a Rust closure on `pi.on`. The inspection did not authorize a tool call. A failed registration surface is the reject reason.

## Alternative implemented

Later e18 stories stay on the standalone NAPI package. The private helper crate `pi-api` at `extensions/tool-permissions/native/crates/pi-api` is the implemented ExtensionAPI wrapper. It is `publish = false`, edition 2024, and a member of the Cargo workspace at `extensions/tool-permissions/native`. `Pi::new` stores `on`, `registerCommand`, and `registerEntryRenderer`. `OnCallback::as_str` names the TypeScript events. `Bridge::forward_on` registers the two-argument `pi.on` callbacks. Command and renderer registration stay in the extension. e18s06 is when Rust owns those `pi.on` handlers and the JavaScript `handle*` bridge goes away. `extensions/tool-permissions/index.ts` remains the loader.
