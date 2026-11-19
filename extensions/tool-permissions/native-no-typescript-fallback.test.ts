import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import toolPermissionPolicy from "./index.ts";
import { setNativePackagePathForTests } from "./native-package.ts";
import {
  createTestExtensionHost,
  withCapturedProcessExit,
} from "./native-host-test-support.ts";
import { registerNativeToolPermissionsCallbacks } from "./native-registration-loader.ts";
import { loadNativeProbe } from "./native-loader.ts";

test("a missing native package reports unavailable instead of a TypeScript engine", () => {
  const previousDisable = process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE = "1";
  try {
    const result = registerNativeToolPermissionsCallbacks({
      registerCommand() {},
      registerEntryRenderer() {},
      on() {},
    } as never);
    assert.deepEqual(result, {
      mode: "unavailable",
      reason: "native package disabled",
    });
  } finally {
    if (previousDisable === undefined)
      delete process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE = previousDisable;
  }
});

test("a rejected native probe reports unavailable instead of a TypeScript engine", async () => {
  const result = await loadNativeProbe({
    load: async () => {
      throw new Error("package missing");
    },
  });
  assert.equal(result.engine, "unavailable");
  assert.match(result.reason, /package missing/);
});

test("missing WASM crashes Pi with build instructions and does not authorize through TypeScript", () => {
  const previousDisable = process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  const previousPackage = process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
  process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE = "1";
  delete process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;

  const handlers: string[] = [];
  const errors: string[] = [];
  const previousError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  try {
    const { exitCode, error } = withCapturedProcessExit(() =>
      toolPermissionPolicy(
        createTestExtensionHost({
          on(event) {
            handlers.push(event);
          },
        }) as never,
      ),
    );
    assert.equal(exitCode, 1);
    assert.match(errors.join("\n"), /npm run build:native/);
    assert.match(errors.join("\n"), /WASI_SDK_PATH|wasi-sdk/i);
    assert.match(error?.message ?? "", /process\.exit\(1\)/);
    assert.equal(handlers.includes("tool_call"), false);
  } finally {
    console.error = previousError;
    if (previousDisable === undefined)
      delete process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE = previousDisable;
    if (previousPackage === undefined)
      delete process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE = previousPackage;
  }
});

test("incomplete native registration fails closed instead of installing TypeScript tool_call", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "pi-no-ts-fallback-incomplete-"),
  );
  const packagePath = join(directory, "index.cjs");
  writeFileSync(
    packagePath,
    `
exports.probe = (request) => ({
  version: 1,
  operation: request.operation,
  ok: true,
  nonce: request.nonce,
});
exports.registerToolPermissionsCallbacks = (request, pi, bridge) => {
  pi.on("session_start", (event, ctx) => bridge.handleSessionStart(event, ctx));
  return {
    version: 1,
    operation: "register_callbacks",
    ok: true,
    nonce: request.nonce,
    registrations: ["session_start"],
  };
};
`,
  );
  const previousPackage = process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
  const previousDisable = process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE = "1";
  delete process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  const restore = setNativePackagePathForTests(packagePath);
  const handlers: string[] = [];
  const previousError = console.error;
  console.error = () => {};
  try {
    const { exitCode } = withCapturedProcessExit(() =>
      toolPermissionPolicy(
        createTestExtensionHost({
          on(event) {
            handlers.push(event);
          },
        }) as never,
      ),
    );
    assert.equal(exitCode, 1);
    assert.equal(handlers.includes("tool_call"), false);
  } finally {
    console.error = previousError;
    restore();
    if (previousPackage === undefined)
      delete process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE = previousPackage;
    if (previousDisable === undefined)
      delete process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE = previousDisable;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid WASM fails at load and does not authorize through TypeScript", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-no-ts-fallback-invalid-"));
  const packagePath = join(directory, "index.cjs");
  writeFileSync(
    packagePath,
    `exports.probe = (request) => ({ version: 999, operation: request.operation, ok: true, nonce: request.nonce });\n`,
  );
  const previousPackage = process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
  const previousDisable = process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE = "1";
  delete process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  const restore = setNativePackagePathForTests(packagePath);
  const handlers: string[] = [];
  const previousError = console.error;
  console.error = () => {};
  try {
    const { exitCode } = withCapturedProcessExit(() =>
      toolPermissionPolicy(
        createTestExtensionHost({
          on(event) {
            handlers.push(event);
          },
        }) as never,
      ),
    );
    assert.equal(exitCode, 1);
    assert.equal(handlers.includes("tool_call"), false);
  } finally {
    console.error = previousError;
    restore();
    if (previousPackage === undefined)
      delete process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE = previousPackage;
    if (previousDisable === undefined)
      delete process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE = previousDisable;
    rmSync(directory, { recursive: true, force: true });
  }
});
