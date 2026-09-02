export const WASM_CONTRACT_VERSION = 1 as const;

export type WasmProbeRequest = {
  version: typeof WASM_CONTRACT_VERSION;
  operation: "health";
  payload: { nonce: string };
};

export type WasmProbeResponse = {
  version: typeof WASM_CONTRACT_VERSION;
  operation: "health";
  ok: true;
  payload: { nonce: string };
};

export function createProbeRequest(nonce: string): WasmProbeRequest {
  return {
    version: WASM_CONTRACT_VERSION,
    operation: "health",
    payload: { nonce },
  };
}

export function decodeProbeResponse(value: unknown): WasmProbeResponse {
  throw new Error("WASM contract decoder is not implemented");
}
