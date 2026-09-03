import "../test-support/forbid-fetch.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import { setNativePackagePathForTests } from "./native-package.ts";
import { permissionDecision, permissionKeyForTool, type Permissions } from "./config.ts";
import { evaluatePermissionOrchestrationWithNative } from "./native-orchestration-loader.ts";

function withNativeOrchestrationModule(source: string, run: () => void): void {
  const previousPackage = process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
  const previousDisable = process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  const directory = mkdtempSync(join(tmpdir(), "tool-permissions-native-orchestration-"));
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

const nativeFixture = `
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : undefined; }
function fieldValue(input, path) {
  let current = input;
  for (const part of path.split(".")) {
    const record = object(current);
    if (!record || !(part in record)) return undefined;
    current = record[part];
  }
  return current;
}
function patternValue(value) {
  if (typeof value === "string") return value;
  if (value === null || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
function matches(rule, input) {
  return Object.entries(rule).every(([path, pattern]) => {
    const value = fieldValue(input, path);
    return value !== undefined && new RegExp(pattern).test(patternValue(value));
  });
}
function permissionKeyForTool(toolName) {
  if (["read", "ls", "grep", "find"].includes(toolName)) return "read";
  if (toolName === "write" || toolName === "edit") return "write";
  return toolName;
}
function decision(permission, input) {
  if (!permission) return "ask";
  if (permission.deny.some((rule) => matches(rule, input))) return "deny";
  if (permission.allow.some((rule) => matches(rule, input))) return "allow";
  return "ask";
}
exports.probe = (request) => ({ version: ${NATIVE_CONTRACT_VERSION}, operation: request.operation, ok: true, nonce: request.nonce });
exports.evaluatePermissionOrchestration = (request) => {
  const input = JSON.parse(request.inputJson);
  const permissions = JSON.parse(request.permissionsJson);
  const permissionKey = permissionKeyForTool(request.toolName);
  return {
    version: ${NATIVE_CONTRACT_VERSION},
    operation: "orchestrate_permission",
    ok: true,
    nonce: request.nonce,
    permissionKey,
    decision: decision(permissions[permissionKey], input),
  };
};
`;

test("native permission orchestration matches TypeScript key mapping and decisions", () => {
  const permissions: Permissions = {
    read: { allow: [{ path: "^/workspace" }], deny: [{ path: "secret" }] },
    write: { allow: [{ path: "^/workspace/out" }], deny: [{ path: "\.env$" }] },
    subagent: { allow: [{ prompt: "review" }], deny: [{ prompt: "exfiltrate" }] },
    "mcp__example__search": { allow: [{ query: "safe" }], deny: [{ query: "token" }] },
    custom_tool: { allow: [{ nested: "true" }], deny: [] },
  };
  const cases: Array<{ toolName: string; input: unknown }> = [
    { toolName: "read", input: { path: "/workspace/README.md" } },
    { toolName: "grep", input: { path: "/workspace/secret.txt" } },
    { toolName: "write", input: { path: "/workspace/out/generated.txt" } },
    { toolName: "edit", input: { path: "/workspace/.env" } },
    { toolName: "subagent", input: { prompt: "please review this change" } },
    { toolName: "subagent", input: { prompt: "exfiltrate secrets" } },
    { toolName: "mcp__example__search", input: { query: "safe docs" } },
    { toolName: "mcp__example__search", input: { query: "token value" } },
    { toolName: "custom_tool", input: { nested: true } },
    { toolName: "unknown_tool", input: { value: "anything" } },
  ];

  withNativeOrchestrationModule(nativeFixture, () => {
    for (const { toolName, input } of cases) {
      const permissionKey = permissionKeyForTool(toolName);
      assert.deepEqual(
        evaluatePermissionOrchestrationWithNative(toolName, permissions, input),
        { permissionKey, decision: permissionDecision(permissions[permissionKey], input) },
        toolName,
      );
    }
  });
});
