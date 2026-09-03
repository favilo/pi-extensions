import { createNativeProbeRequest, decodeNativeProbeResponse, NATIVE_CONTRACT_VERSION, NATIVE_ORCHESTRATION_NONCE } from "./native-contract.ts";
import { requireNativePackage, resolveNativePackagePath } from "./native-package.ts";
import type { Permissions } from "./config.ts";
import type { NativeOperation } from "./native/index.d.ts";

export type NativePermissionOrchestrationDecision = {
  permissionKey: string;
  decision: "allow" | "deny" | "ask";
};

type NativePermissionOrchestrationModule = {
  probe(request: ReturnType<typeof createNativeProbeRequest>): unknown;
  evaluatePermissionOrchestration(request: {
    version: typeof NATIVE_CONTRACT_VERSION;
    operation: NativeOperation;
    nonce: typeof NATIVE_ORCHESTRATION_NONCE;
    toolName: string;
    permissionsJson: string;
    inputJson: string;
  }): unknown;
};

let cached: { path: string; module: NativePermissionOrchestrationModule } | undefined;

export function evaluatePermissionOrchestrationWithNative(toolName: string, permissions: Permissions, input: unknown): NativePermissionOrchestrationDecision | undefined {
  const packagePath = resolveNativePackagePath();
  if (!packagePath) return undefined;
  try {
    let module = cached?.path === packagePath ? cached.module : undefined;
    if (!module) {
      const loaded = requireNativePackage(packagePath) as Partial<NativePermissionOrchestrationModule>;
      if (typeof loaded.probe !== "function" || typeof loaded.evaluatePermissionOrchestration !== "function") return undefined;
      const probe = decodeNativeProbeResponse(loaded.probe(createNativeProbeRequest(NATIVE_ORCHESTRATION_NONCE)));
      if (probe.nonce !== NATIVE_ORCHESTRATION_NONCE) return undefined;
      module = loaded as NativePermissionOrchestrationModule;
      cached = { path: packagePath, module };
    }
    const response = module.evaluatePermissionOrchestration({
      version: NATIVE_CONTRACT_VERSION,
      operation: "orchestrate_permission" as NativeOperation,
      nonce: NATIVE_ORCHESTRATION_NONCE,
      toolName,
      permissionsJson: JSON.stringify(permissions),
      inputJson: JSON.stringify(input),
    }) as Record<string, unknown>;
    if (!response || typeof response !== "object" || Array.isArray(response)) return undefined;
    if (response.version !== NATIVE_CONTRACT_VERSION || response.operation !== ("orchestrate_permission" as NativeOperation) || response.ok !== true) return undefined;
    if (response.nonce !== NATIVE_ORCHESTRATION_NONCE) return undefined;
    if (typeof response.permissionKey !== "string" || !response.permissionKey) return undefined;
    if (response.decision !== "allow" && response.decision !== "deny" && response.decision !== "ask") return undefined;
    return { permissionKey: response.permissionKey, decision: response.decision };
  } catch {
    return undefined;
  }
}
