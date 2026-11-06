import { createNativeProbeRequest, decodeNativeProbeResponse, NATIVE_CONTRACT_VERSION, NATIVE_POLICY_NONCE, type NativeOperation } from "./native-contract.ts";
import { requireNativePackage, resolveNativePackagePath } from "./native-package.ts";
import type { Permissions } from "./config.ts";

type NativePolicy = { probe(request: unknown): unknown; parsePolicy(request: unknown): unknown };
let cached: { path: string; module: NativePolicy } | undefined;

export function parsePolicyWithNativeFallback(source: string, fallback: () => Permissions): Permissions {
  const packagePath = resolveNativePackagePath();
  if (!packagePath) return fallback();
  try {
    let module = cached?.path === packagePath ? cached.module : undefined;
    if (!module) {
      const loaded = requireNativePackage(packagePath) as Partial<NativePolicy>;
      if (typeof loaded.probe !== "function" || typeof loaded.parsePolicy !== "function") throw new Error("native policy module is missing exports");
      const probe = decodeNativeProbeResponse(loaded.probe(createNativeProbeRequest(NATIVE_POLICY_NONCE)));
      if (probe.nonce !== NATIVE_POLICY_NONCE) throw new Error("native policy probe nonce mismatch");
      module = loaded as NativePolicy;
      cached = { path: packagePath, module };
    }
    const value = module.parsePolicy({ version: NATIVE_CONTRACT_VERSION, operation: "policy" as NativeOperation, nonce: NATIVE_POLICY_NONCE, source }) as Record<string, unknown>;
    if (value.version !== NATIVE_CONTRACT_VERSION || value.operation !== ("policy" as NativeOperation) || value.nonce !== NATIVE_POLICY_NONCE || value.ok !== true) throw new Error("native policy response is invalid");
    return decodePermissions(value.permissions);
  } catch {
    return fallback();
  }
}

function decodePermissions(value: unknown): Permissions {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("native permissions must be an object");
  const permissions: Permissions = {};
  for (const [tool, permission] of Object.entries(value)) {
    if (!permission || typeof permission !== "object" || Array.isArray(permission)) throw new Error(`native permission for ${tool} is invalid`);
    const record = permission as Record<string, unknown>;
    permissions[tool] = { allow: decodeRules(record.allow), deny: decodeRules(record.deny) };
  }
  return permissions;
}

function decodeRules(value: unknown): Array<Record<string, string>> {
  if (!Array.isArray(value)) throw new Error("native permission rules must be arrays");
  return value.map((rule) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw new Error("native permission rule must be an object");
    const decoded: Record<string, string> = {};
    for (const [path, pattern] of Object.entries(rule)) {
      if (!path || typeof pattern !== "string") throw new Error("native permission rule fields must be strings");
      decoded[path] = pattern;
    }
    return decoded;
  });
}
