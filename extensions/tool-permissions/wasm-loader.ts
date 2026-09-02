import { readFileSync } from "node:fs";
import { decodeProbeResponse, type WasmProbeRequest, type WasmProbeResponse } from "./wasm-contract.ts";

export type WasmModule = {
  probe(request: WasmProbeRequest): unknown | Promise<unknown>;
};

export type WasmLoaderOptions = {
  artifactPath: string;
  nonce?: string;
  instantiate?: (artifact: Uint8Array) => WasmModule | Promise<WasmModule>;
};

export type WasmLoadResult =
  | { engine: "wasm"; response: WasmProbeResponse }
  | { engine: "typescript"; reason: string };

export async function loadWasmProbe(options: WasmLoaderOptions): Promise<WasmLoadResult> {
  // Stub intentionally falls back until the RED contract is implemented.
  void options;
  return { engine: "typescript", reason: "WASM probe unavailable" };
}

export function readWasmArtifact(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

export { decodeProbeResponse };
