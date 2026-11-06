import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../extensions/tool-permissions/native/generated/index.wasi.cjs", import.meta.url);
const marker = "__wasi_init_tp()";
const needle = "memory: __sharedMemory,";
const replacement = `${needle}\n        // Rust's wasm32-wasip1-threads target imports this symbol. Node's WASI preview1 does not provide it.\n        __wasi_init_tp() {},`;

const source = readFileSync(path, "utf8");
if (source.includes(marker)) process.exit(0);
if (!source.includes(needle)) {
  throw new Error("generated WASI loader has no shared-memory import object to patch");
}
writeFileSync(path, source.replace(needle, replacement));
