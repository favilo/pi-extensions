import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createToolPermissionBoundary } from "./index.ts";
import { executeToolRequest, type ToolRequest } from "./permission-boundary.ts";

test("missing WASM denies a protected tool call and does not authorize through TypeScript", async () => {
  const previousDisable = process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  const previousPackage = process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
  process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE = "1";
  delete process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;

  const root = mkdtempSync(join(tmpdir(), "pi-no-ts-fallback-"));
  const cwd = join(root, "project");
  mkdirSync(cwd);
  writeFileSync(join(cwd, "notes.txt"), "hello");

  const executions: string[] = [];
  try {
    const boundary = createToolPermissionBoundary({
      execute: async (request) => {
        executions.push(request.toolName);
        return "ran";
      },
    });
    const request: ToolRequest = {
      actor: { kind: "main" },
      toolName: "read",
      input: { path: "notes.txt" },
      cwd,
    };
    const result = await executeToolRequest(request, boundary);

    assert.equal(result.status, "denied");
    assert.equal(executions.length, 0);
    assert.match(
      result.reason ?? "",
      /wasm|native|unavailable|did not load|no alternate/i,
    );
  } finally {
    if (previousDisable === undefined)
      delete process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE = previousDisable;
    if (previousPackage === undefined)
      delete process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_PACKAGE = previousPackage;
    rmSync(root, { recursive: true, force: true });
  }
});
