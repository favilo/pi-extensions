import "../test-support/forbid-fetch.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import { setNativePackagePathForTests } from "./native-package.ts";
import { registerNativeToolPermissionsCallbacks } from "./native-registration-loader.ts";

function withNativeRegistrationModule(source: string, run: () => void): void {
  const previousPackage = process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
  const previousDisable = process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  const directory = mkdtempSync(join(tmpdir(), "tool-permissions-native-registration-"));
  const packagePath = join(directory, "index.cjs");
  writeFileSync(packagePath, source, "utf8");
  process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE = "1";
  delete process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  const restorePackagePath = setNativePackagePathForTests(packagePath);
  try {
    run();
  } finally {
    restorePackagePath();
    if (previousPackage === undefined) delete process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE = previousPackage;
    if (previousDisable === undefined) delete process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE = previousDisable;
    rmSync(directory, { recursive: true, force: true });
  }
}

const compatibleProbe = `exports.probe = (request) => ({ version: ${NATIVE_CONTRACT_VERSION}, operation: request.operation, ok: true, nonce: request.nonce });`;

test("native registration uses a constrained facade to install lifecycle diagnostics", async () => {
  const moduleSource = `${compatibleProbe}
exports.registerToolPermissionsCallbacks = (request, facade) => {
  assert.deepStrictEqual(Object.keys(facade).sort(), ["registerSessionStartNotice"]);
  facade.registerSessionStartNotice("Rust native registration active.", "info");
  return { version: ${NATIVE_CONTRACT_VERSION}, operation: "register_callbacks", ok: true, nonce: request.nonce, registrations: ["session_start"] };
};
const assert = require("node:assert/strict");
`;
  const handlers = new Map<string, (event: unknown, ctx: any) => unknown>();
  withNativeRegistrationModule(moduleSource, () => {
    const result = registerNativeToolPermissionsCallbacks({
      on(eventName, handler) { handlers.set(eventName, handler); },
    });
    assert.deepEqual(result, { mode: "native", registrations: ["session_start"] });
  });
  const notices: Array<{ message: string; level: string }> = [];
  await handlers.get("session_start")?.({}, { hasUI: true, ui: { notify: (message: string, level: string) => notices.push({ message, level }) } });
  assert.deepEqual(notices, [{ message: "Rust native registration active.", level: "info" }]);
});

test("native registration falls back without installing duplicate callbacks", () => {
  const handlers: Array<string> = [];
  withNativeRegistrationModule(compatibleProbe, () => {
    const result = registerNativeToolPermissionsCallbacks({
      on(eventName) { handlers.push(eventName); },
    });
    assert.equal(result.mode, "typescript");
  });
  assert.deepEqual(handlers, []);
});
