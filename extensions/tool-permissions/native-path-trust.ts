import { NATIVE_CONTRACT_VERSION, type PathTrustRequest, type PathTrustResult } from "./native-contract.ts";

/** Stub until the WASM path-trust operation returns the host canonical path. */
export function evaluatePathTrust(request: PathTrustRequest): PathTrustResult {
  return {
    version: NATIVE_CONTRACT_VERSION,
    operation: "path_trust",
    ok: false,
    nonce: request.nonce,
    path: "",
    cwd: "",
    trustEligible: false,
    aiignoreMatch: false,
    decision: "deny",
  };
}
