import type { Permissions } from "./config.ts";

export type NativePermissionOrchestrationDecision = {
  permissionKey: string;
  decision: "allow" | "deny" | "ask";
};

export function evaluatePermissionOrchestrationWithNative(_toolName: string, _permissions: Permissions, _input: unknown): NativePermissionOrchestrationDecision | undefined {
  return undefined;
}
