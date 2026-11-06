export type NativeOperation =
  | "health"
  | "parse"
  | "policy"
  | "evaluate"
  | "evaluate_permission"
  | "orchestrate_permission"
  | "register_callbacks";

export type PermissionDecision = "allow" | "deny" | "ask";

export const NATIVE_CONTRACT_VERSION = 1 as const;

export const NATIVE_POLICY_NONCE = "tool-permissions-policy" as const;
export const NATIVE_PARSER_NONCE = "tool-permissions-parser" as const;
export const NATIVE_EVALUATION_NONCE = "tool-permissions-evaluation" as const;
export const NATIVE_ORCHESTRATION_NONCE = "tool-permissions-orchestration" as const;
export const NATIVE_REGISTRATION_NONCE = "tool-permissions-registration" as const;

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
  if (!nonce || nonce.length > 256) throw new Error("native probe nonce must be 1-256 characters");
  return { version: NATIVE_CONTRACT_VERSION, operation: "health", nonce };
}

export function decodeNativeProbeResponse(value: unknown): NativeProbeResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("native contract response must be an object");
  }
  const response = value as Record<string, unknown>;
  if (response.version !== NATIVE_CONTRACT_VERSION) {
    throw new Error(`native contract version mismatch: expected ${NATIVE_CONTRACT_VERSION}`);
  }
  if (response.operation !== "health" || response.ok !== true) {
    throw new Error("native contract response is invalid");
  }
  if (typeof response.nonce !== "string" || !response.nonce || response.nonce.length > 256) {
    throw new Error("native contract response nonce is invalid");
  }
  return {
    version: NATIVE_CONTRACT_VERSION,
    operation: "health",
    ok: true,
    nonce: response.nonce,
  };
}
