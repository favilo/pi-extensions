export const NATIVE_CONTRACT_VERSION = 1 as const;

export type NativeProbeRequest = {
  version: typeof NATIVE_CONTRACT_VERSION;
  operation: "health";
  nonce: string;
};

export type NativeProbeResponse = {
  version: typeof NATIVE_CONTRACT_VERSION;
  operation: "health";
  ok: true;
  nonce: string;
};

export function createNativeProbeRequest(nonce: string): NativeProbeRequest {
  return { version: NATIVE_CONTRACT_VERSION, operation: "health", nonce };
}

export function decodeNativeProbeResponse(value: unknown): NativeProbeResponse {
  throw new Error("native contract decoder is not implemented");
}
