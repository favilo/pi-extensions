import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setNativePackagePathForTests } from "./native-package.ts";

/** Minimal native package exports that register host callbacks through the bridge. */
export const NATIVE_REGISTRATION_STUB = `
exports.probe = (request) => ({
  version: 1,
  operation: request.operation,
  ok: true,
  nonce: request.nonce,
});
exports.registerToolPermissionsCallbacks = (request, pi, bridge) => {
  pi.on("session_start", (event, ctx) => bridge.handleSessionStart(event, ctx));
  pi.on("tool_call", (event, ctx) => bridge.handleToolCall(event, ctx));
  pi.on("tool_result", (event, ctx) => bridge.handleToolResult?.(event, ctx));
  pi.on("session_shutdown", (event, ctx) =>
    bridge.handleSessionShutdown?.(event, ctx),
  );
  if (typeof pi.registerCommand === "function") {
    pi.registerCommand("permissions", {
      description: "Edit user or local tool permissions",
      handler: (args, ctx) => bridge.handlePermissionsCommand?.(args, ctx),
    });
  }
  if (typeof pi.registerEntryRenderer === "function") {
    pi.registerEntryRenderer(
      "permission-preview",
      bridge.renderPermissionPreview,
    );
  }
  return {
    version: 1,
    operation: "register_callbacks",
    ok: true,
    nonce: request.nonce,
    registrations: [
      "session_start",
      "tool_call",
      "tool_result",
      "session_shutdown",
      "command:permissions",
      "entry_renderer:permission-preview",
    ],
  };
};
`;

export function withNativeHostPackage(
  extraSource: string,
  run: (packagePath: string) => void | Promise<void>,
): Promise<void> | void {
  const previousPackage = process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
  const previousDisable = process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  const directory = mkdtempSync(join(tmpdir(), "tool-permissions-native-host-"));
  const packagePath = join(directory, "index.cjs");
  writeFileSync(packagePath, `${NATIVE_REGISTRATION_STUB}\n${extraSource}\n`);
  process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE = "1";
  delete process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  const restore = setNativePackagePathForTests(packagePath);
  const finish = () => {
    restore();
    if (previousPackage === undefined)
      delete process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE = previousPackage;
    if (previousDisable === undefined)
      delete process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE = previousDisable;
    rmSync(directory, { recursive: true, force: true });
  };
  try {
    const result = run(packagePath);
    if (result && typeof (result as Promise<void>).then === "function") {
      return (result as Promise<void>).finally(finish);
    }
    finish();
  } catch (error) {
    finish();
    throw error;
  }
}

/** Capture process.exit so fatal native-load crashes are testable. */
export function withCapturedProcessExit(run: () => void): {
  exitCode: number | undefined;
  error: Error | undefined;
} {
  const previousExit = process.exit;
  let exitCode: number | undefined;
  let error: Error | undefined;
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`process.exit(${exitCode})`);
  }) as typeof process.exit;
  try {
    run();
  } catch (caught) {
    error = caught instanceof Error ? caught : new Error(String(caught));
  } finally {
    process.exit = previousExit;
  }
  return { exitCode, error };
}

/** Minimal ExtensionAPI surface that satisfies native registration. */
export function createTestExtensionHost(options?: {
  on?: (event: string, handler: (...args: never[]) => unknown) => void;
  getAllTools?: () => Array<{ name: string }>;
}) {
  return {
    registerCommand() {},
    registerEntryRenderer() {},
    on(event: string, handler: (...args: never[]) => unknown) {
      options?.on?.(event, handler);
    },
    getAllTools: options?.getAllTools ?? (() => []),
  };
}
