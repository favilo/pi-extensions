import "../test-support/forbid-fetch.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseWithNativeFallback } from "./native-parser-loader.ts";
import { parsePolicyWithNativeFallback } from "./native-policy-loader.ts";
import { evaluatePermissionWithNative } from "./native-evaluation-loader.ts";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import { setNativePackagePathForTests } from "./native-package.ts";
import type { BashParseResult } from "./bash-parser.ts";
import type { Permissions, ToolPermission } from "./config.ts";

function withNativeModule(source: string, run: (packagePath: string) => void): void {
  const previous = process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
  const directory = mkdtempSync(join(tmpdir(), "tool-permissions-native-fallback-"));
  const packagePath = join(directory, "index.cjs");
  writeFileSync(packagePath, source);
  process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE = "1";
  const restoreOverride = setNativePackagePathForTests(packagePath);
  try {
    run(packagePath);
  } finally {
    restoreOverride();
    if (previous === undefined) delete process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE = previous;
    rmSync(directory, { recursive: true, force: true });
  }
}

const compatibleProbe = `
exports.probe = (request) => ({ version: ${NATIVE_CONTRACT_VERSION}, operation: request.operation, ok: true, nonce: request.nonce });
`;

test("operation loaders reject a compatible probe response with the wrong nonce", () => {
  const wrongProbe = `exports.probe = (request) => ({ version: ${NATIVE_CONTRACT_VERSION}, operation: request.operation, ok: true, nonce: "wrong-probe" });`;

  withNativeModule(`${wrongProbe}
exports.parse = (request) => ({ version: ${NATIVE_CONTRACT_VERSION}, operation: "parse", ok: true, nonce: request.nonce, reason: "", detail: "", subcommands: [{ normalized: "native", command: "native", args: [], start: 0, end: 6 }] });
`, () => {
    const fallback = (): BashParseResult => ({ ok: true, subcommands: [{ normalized: "fallback", command: "fallback", args: [], span: { start: 0, end: 8 } }] });
    assert.deepEqual(parseWithNativeFallback("native", fallback), fallback());
  });

  withNativeModule(`${wrongProbe}
exports.parsePolicy = (request) => ({ version: ${NATIVE_CONTRACT_VERSION}, operation: "policy", ok: true, nonce: request.nonce, permissions: { bash: { allow: [{ command: "^native$" }], deny: [] } } });
`, () => {
    const fallbackPermissions: Permissions = { bash: { allow: [{ command: "^fallback$" }], deny: [] } };
    assert.deepEqual(parsePolicyWithNativeFallback("[permissions.bash]", () => fallbackPermissions), fallbackPermissions);
  });

  withNativeModule(`${wrongProbe}
exports.evaluatePermission = (request) => ({ version: ${NATIVE_CONTRACT_VERSION}, operation: "evaluate_permission", ok: true, nonce: request.nonce, decision: "allow" });
`, () => {
    assert.equal(evaluatePermissionWithNative({ allow: [{}], deny: [] }, { command: "native" }), undefined);
  });
});

test("evaluation adapter accepts only evaluate_permission responses from evaluatePermission", () => {
  const permission: ToolPermission = { allow: [{}], deny: [] };
  withNativeModule(`${compatibleProbe}
exports.evaluatePermission = (request) => ({ version: ${NATIVE_CONTRACT_VERSION}, operation: "evaluate_permission", ok: true, nonce: request.nonce, decision: "allow" });
`, () => {
    assert.equal(evaluatePermissionWithNative(permission, { command: "native" }), "allow");
  });

  withNativeModule(`${compatibleProbe}
exports.evaluatePermission = (request) => ({ version: ${NATIVE_CONTRACT_VERSION}, operation: "evaluate", ok: true, nonce: request.nonce, decision: "allow" });
`, () => {
    assert.equal(evaluatePermissionWithNative(permission, { command: "native" }), undefined);
  });
});

test("parser adapter falls back when native parse throws or returns incompatible output", () => {
  for (const parseBody of [
    `throw new Error("boom")`,
    `return { version: ${NATIVE_CONTRACT_VERSION}, operation: "parse", ok: true, nonce: "wrong", subcommands: [] }`,
    `return { version: ${NATIVE_CONTRACT_VERSION}, operation: "parse", ok: true, nonce: request.nonce, subcommands: [{ normalized: "jj status", command: "jj", args: ["status"], start: 4, end: 2 }] }`,
  ]) {
    withNativeModule(`${compatibleProbe}\nexports.parse = (request) => { ${parseBody}; };`, () => {
      let fallbackCalls = 0;
      const fallback = (): BashParseResult => {
        fallbackCalls += 1;
        return { ok: true, subcommands: [{ normalized: "fallback", command: "fallback", args: [], span: { start: 0, end: 8 } }] };
      };
      assert.deepEqual(parseWithNativeFallback("jj status", fallback), fallback());
      assert.equal(fallbackCalls, 2);
    });
  }
});

test("policy adapter falls back when native policy output has a mismatched nonce", () => {
  withNativeModule(`${compatibleProbe}
exports.parsePolicy = () => ({
  version: ${NATIVE_CONTRACT_VERSION},
  operation: "policy",
  ok: true,
  nonce: "wrong-nonce",
  permissions: { bash: { allow: [{ command: "^native$" }], deny: [] } },
});
`, () => {
    const fallbackPermissions: Permissions = { bash: { allow: [{ command: "^fallback$" }], deny: [] } };
    assert.deepEqual(parsePolicyWithNativeFallback("[permissions.bash]", () => fallbackPermissions), fallbackPermissions);
  });
});

test("policy adapter falls back when native policy throws or returns malformed permissions", () => {
  for (const parsePolicyBody of [
    `throw new Error("boom")`,
    `return { version: ${NATIVE_CONTRACT_VERSION}, operation: "policy", ok: true, nonce: request.nonce, permissions: { bash: { allow: [{ command: 42 }], deny: [] } } }`,
  ]) {
    withNativeModule(`${compatibleProbe}\nexports.parsePolicy = (request) => { ${parsePolicyBody}; };`, () => {
      const fallbackPermissions: Permissions = { bash: { allow: [{ command: "^fallback$" }], deny: [] } };
      assert.deepEqual(parsePolicyWithNativeFallback("[permissions.bash]", () => fallbackPermissions), fallbackPermissions);
    });
  }
});

test("evaluation adapter declines malformed or throwing native evaluator results", () => {
  const permission: ToolPermission = { allow: [{ command: "^native$" }], deny: [] };
  for (const evaluateBody of [
    `throw new Error("boom")`,
    `return { version: ${NATIVE_CONTRACT_VERSION}, operation: "evaluate", ok: true, nonce: "wrong", decision: "allow" }`,
    `return { version: ${NATIVE_CONTRACT_VERSION}, operation: "evaluate", ok: true, nonce: request.nonce, decision: "maybe" }`,
  ]) {
    withNativeModule(`${compatibleProbe}\nexports.evaluatePermission = (request) => { ${evaluateBody}; };`, () => {
      assert.equal(evaluatePermissionWithNative(permission, { command: "native" }), undefined);
    });
  }
});
