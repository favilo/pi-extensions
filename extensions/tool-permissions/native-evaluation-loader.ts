import { createRequire } from "node:module";
import { createNativeProbeRequest, decodeNativeProbeResponse, NATIVE_CONTRACT_VERSION, NATIVE_EVALUATION_NONCE } from "./native-contract.ts";
import type { ToolPermission } from "./config.ts";
import type { NativeOperation } from "./native/index.d.ts";

export type NativeDecision = "allow" | "deny" | "ask";
type NativeModule = { evaluatePermission(request: unknown): unknown };
let cached: { path: string; module: NativeModule } | undefined;

export function evaluatePermissionWithNative(permission: ToolPermission | undefined, input: unknown): NativeDecision | undefined {
  const path = process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
  if (!path || !permission) return undefined;
  try {
    let module = cached?.path === path ? cached.module : undefined;
    if (!module) {
      module = createRequire(import.meta.url)(path) as NativeModule;
      if (typeof module.evaluatePermission !== "function" || typeof (module as NativeModule & { probe?: unknown }).probe !== "function") return undefined;
      decodeNativeProbeResponse((module as NativeModule & { probe: (request: unknown) => unknown }).probe(createNativeProbeRequest(NATIVE_EVALUATION_NONCE)));
      cached = { path, module };
    }
    const result = module.evaluatePermission({ version: NATIVE_CONTRACT_VERSION, operation: "evaluate_permission" as NativeOperation, nonce: NATIVE_EVALUATION_NONCE, allow: permission.allow, deny: permission.deny, inputJson: JSON.stringify(input) }) as Record<string, unknown>;
    if (result.ok !== true || result.version !== NATIVE_CONTRACT_VERSION || result.operation !== ("evaluate" as NativeOperation) || result.nonce !== NATIVE_EVALUATION_NONCE || !["allow", "deny", "ask"].includes(result.decision as string)) return undefined;
    return result.decision as NativeDecision;
  } catch {
    return undefined;
  }
}
