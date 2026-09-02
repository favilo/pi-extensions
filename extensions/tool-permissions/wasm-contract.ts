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
  if (!nonce || nonce.length > 256) throw new Error("probe nonce must be 1-256 characters");
  return {
    version: WASM_CONTRACT_VERSION,
    operation: "health",
    payload: { nonce },
  };
}

export function decodeProbeResponse(value: unknown): WasmProbeResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("WASM contract response must be an object");
  }
  const response = value as Record<string, unknown>;
  if (response.version !== WASM_CONTRACT_VERSION) {
    throw new Error(`WASM contract version mismatch: expected ${WASM_CONTRACT_VERSION}`);
  }
  if (response.operation !== "health" || response.ok !== true) {
    throw new Error("WASM contract response is invalid");
  }
  const payload = response.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("WASM contract response payload is invalid");
  }
  const nonce = (payload as Record<string, unknown>).nonce;
  if (typeof nonce !== "string" || !nonce || nonce.length > 256) {
    throw new Error("WASM contract response nonce is invalid");
  }
  return {
    version: WASM_CONTRACT_VERSION,
    operation: "health",
    ok: true,
    payload: { nonce },
  };
}
