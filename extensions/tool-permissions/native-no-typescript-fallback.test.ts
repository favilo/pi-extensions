import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import toolPermissionPolicy from "./index.ts";

test("missing WASM fails at load and does not authorize through TypeScript", () => {
  const previousDisable = process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  const previousPackage = process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
  process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE = "1";
  delete process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;

  const handlers: string[] = [];
  try {
    assert.throws(
      () =>
        toolPermissionPolicy({
          registerCommand() {},
          on(event: string) {
            handlers.push(event);
          },
        } as never),
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
