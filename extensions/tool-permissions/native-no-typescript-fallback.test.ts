import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import toolPermissionPolicy from "./index.ts";
import { setNativePackagePathForTests } from "./native-package.ts";
import { createTestExtensionHost } from "./native-host-test-support.ts";

test("missing WASM fails at load and does not authorize through TypeScript", () => {
  const previousDisable = process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  const previousPackage = process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
  process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE = "1";
  delete process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;

  const handlers: string[] = [];
  try {
    assert.throws(
      () =>
        toolPermissionPolicy(
          createTestExtensionHost({
            on(event) {
              handlers.push(event);
            },
          }) as never,
        ),
      /wasm|native|unavailable|did not load|no alternate/i,
    );
    assert.equal(handlers.includes("tool_call"), false);
  } finally {
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
  try {
    assert.throws(
      () =>
        toolPermissionPolicy(
          createTestExtensionHost({
            on(event) {
              handlers.push(event);
            },
          }) as never,
        ),
      /wasm|native|unavailable|incomplete|tool_call|no alternate/i,
    );
    assert.equal(handlers.includes("tool_call"), false);
  } finally {
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
  try {
    assert.throws(
      () =>
        toolPermissionPolicy(
          createTestExtensionHost({
            on(event) {
              handlers.push(event);
            },
          }) as never,
        ),
      /wasm|native|unavailable|did not load|no alternate/i,
    );
    assert.equal(handlers.includes("tool_call"), false);
  } finally {
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
