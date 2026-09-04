import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createNativeProbeRequest, decodeNativeProbeResponse, NATIVE_CONTRACT_VERSION, NATIVE_REGISTRATION_NONCE } from "./native-contract.ts";
import { requireNativePackage, resolveNativePackagePath } from "./native-package.ts";
import type { NativeOperation } from "./native/index.d.ts";

export type NativeRegistrationResult =
  | { mode: "native"; registrations: string[] }
  | { mode: "typescript"; reason: string };

type NativeRegistrationHost = Pick<ExtensionAPI, "on" | "registerCommand" | "registerEntryRenderer">;

type NativeRegistrationBridge = {
  renderPermissionPreview?(entry: unknown, options: unknown, theme: unknown): unknown;
  handleSessionStart?(event: unknown, ctx: unknown): unknown;
  handleToolCall(event: unknown, ctx: unknown): unknown;
  handleToolResult?(event: unknown, ctx: unknown): unknown;
  handleSessionShutdown?(event: unknown, ctx: unknown): unknown;
  handlePermissionsCommand?(args: unknown, ctx: unknown): unknown;
};

type NativeRegistrationModule = {
  probe(request: ReturnType<typeof createNativeProbeRequest>): unknown;
  registerToolPermissionsCallbacks(request: {
    version: typeof NATIVE_CONTRACT_VERSION;
    operation: NativeOperation;
    nonce: typeof NATIVE_REGISTRATION_NONCE;
  }, pi: NativeRegistrationHost, bridge?: NativeRegistrationBridge): unknown;
};

export function registerNativeToolPermissionsCallbacks(pi: NativeRegistrationHost, bridge?: NativeRegistrationBridge): NativeRegistrationResult {
  const packagePath = resolveNativePackagePath();
  if (!packagePath) return { mode: "typescript", reason: "native package disabled" };
  try {
    const loaded = requireNativePackage(packagePath) as Partial<NativeRegistrationModule>;
    if (typeof loaded.probe !== "function" || typeof loaded.registerToolPermissionsCallbacks !== "function") {
      return { mode: "typescript", reason: "native registration export unavailable" };
    }
    const probe = decodeNativeProbeResponse(loaded.probe(createNativeProbeRequest(NATIVE_REGISTRATION_NONCE)));
    if (probe.nonce !== NATIVE_REGISTRATION_NONCE) return { mode: "typescript", reason: "native registration probe nonce mismatch" };
    const response = loaded.registerToolPermissionsCallbacks({
      version: NATIVE_CONTRACT_VERSION,
      operation: "register_callbacks" as NativeOperation,
      nonce: NATIVE_REGISTRATION_NONCE,
    }, pi, bridge) as Record<string, unknown>;
    if (!response || typeof response !== "object" || Array.isArray(response)) return { mode: "typescript", reason: "native registration response is invalid" };
    if (response.version !== NATIVE_CONTRACT_VERSION || response.operation !== ("register_callbacks" as NativeOperation) || response.ok !== true || response.nonce !== NATIVE_REGISTRATION_NONCE) {
      return { mode: "typescript", reason: "native registration response contract mismatch" };
    }
    if (!Array.isArray(response.registrations) || !response.registrations.every((item) => typeof item === "string")) {
      return { mode: "typescript", reason: "native registration list is invalid" };
    }
    return { mode: "native", registrations: response.registrations };
  } catch (error) {
    return { mode: "typescript", reason: error instanceof Error ? error.message : String(error) };
  }
}
