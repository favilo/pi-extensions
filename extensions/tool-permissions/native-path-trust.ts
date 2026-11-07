import { readFileSync, realpathSync } from "node:fs";
import {
  NATIVE_CONTRACT_VERSION,
  type PathTrustRequest,
  type PathTrustResult,
  type PermissionDecision,
} from "./native-contract.ts";
import {
  requireNativePackage,
  resolveNativePackagePath,
} from "./native-package.ts";

type NativePathTrustRequest = Omit<PathTrustRequest, "trustPath"> & {
  trustPath?: string;
};

type NativePathTrust = {
  evaluatePathTrust(
    request: NativePathTrustRequest,
    realpath: (path: string) => string,
    readFile: (path: string) => string,
  ): PathTrustResult;
};

function denied(request: PathTrustRequest): PathTrustResult {
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

function isDecision(value: unknown): value is PermissionDecision {
  return value === "allow" || value === "deny" || value === "ask";
}

function isPathTrustResult(
  value: unknown,
  request: PathTrustRequest,
): value is PathTrustResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (
    result.version === NATIVE_CONTRACT_VERSION &&
    result.operation === "path_trust" &&
    result.ok === true &&
    result.nonce === request.nonce &&
    typeof result.path === "string" &&
    result.path.length > 0 &&
    typeof result.cwd === "string" &&
    result.cwd.length > 0 &&
    typeof result.trustEligible === "boolean" &&
    typeof result.aiignoreMatch === "boolean" &&
    isDecision(result.decision)
  );
}

export type AdoptedPathTrust =
  | { status: "unavailable" }
  | { status: "invalid" }
  | { status: "ready"; result: PathTrustResult };

/** Load the WASM path-trust result. A missing package stays unavailable so the host can fall back. */
export function adoptPathTrust(request: PathTrustRequest): AdoptedPathTrust {
  const packagePath = resolveNativePackagePath();
  if (!packagePath) return { status: "unavailable" };
  let native: Partial<NativePathTrust>;
  try {
    native = requireNativePackage(packagePath) as Partial<NativePathTrust>;
  } catch {
    return { status: "unavailable" };
  }
  if (typeof native.evaluatePathTrust !== "function")
    return { status: "unavailable" };
  try {
    const nativeRequest: NativePathTrustRequest = {
      ...request,
      trustPath: request.trustPath ?? undefined,
    };
    const result = native.evaluatePathTrust(
      nativeRequest,
      (path) => realpathSync(path),
      (path) => readFileSync(path, "utf8"),
    );
    return isPathTrustResult(result, request)
      ? { status: "ready", result }
      : { status: "invalid" };
  } catch {
    return { status: "invalid" };
  }
}

/** Canonicalize a permission path through the WASM path-trust operation. */
export function evaluatePathTrust(request: PathTrustRequest): PathTrustResult {
  const adopted = adoptPathTrust(request);
  return adopted.status === "ready" ? adopted.result : denied(request);
}
