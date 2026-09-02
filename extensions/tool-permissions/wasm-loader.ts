import { readFileSync } from "node:fs";
import {
  createProbeRequest,
  decodeProbeResponse,
  type WasmProbeRequest,
  type WasmProbeResponse,
} from "./wasm-contract.ts";

export type WasmModule = {
  /** wasm-bindgen exposes the serde request/response as JavaScript objects. */
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
  try {
    const artifact = readWasmArtifact(options.artifactPath);
    if (!options.instantiate) {
      return { engine: "typescript", reason: "WASM runtime is unavailable" };
    }
    const module = await options.instantiate(artifact);
    const request = createProbeRequest(options.nonce ?? "tool-permissions");
    const response = decodeProbeResponse(await module.probe(request));
    if (response.payload.nonce !== request.payload.nonce) {
      throw new Error("WASM contract nonce mismatch");
    }
    return { engine: "wasm", response };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown WASM initialization failure";
    return { engine: "typescript", reason: `WASM probe rejected: ${reason}` };
  }
}

export function readWasmArtifact(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

export { decodeProbeResponse };
