import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stringify as stringifyToml } from "smol-toml";
import { createToolPermissionBoundary, resolvePermissionDecisionForRequest } from "./index.ts";
import { executeToolRequest, type ToolPermissionBoundary, type ToolRequest } from "./permission-boundary.ts";

function request(overrides: Partial<ToolRequest> = {}): ToolRequest {
  return {
    actor: { kind: "child", childId: "amber-otter" },
    toolName: "read",
    input: { path: "notes.md" },
    cwd: "/workspace/project",
    steering: "Inspect the notes.",
    ...overrides,
  };
}

test("allows a child action matching an allow rule without prompting", async () => {
  let prompted = false;
  let executed = false;
  const boundary: ToolPermissionBoundary = {
    evaluate: async () => "allow",
    prompt: async () => {
      prompted = true;
      return "deny";
    },
    execute: async () => {
      executed = true;
      return { text: "contents" };
    },
  };

  const result = await executeToolRequest(request(), boundary);

  assert.deepEqual(result, {
    status: "allowed",
    actor: { kind: "child", childId: "amber-otter" },
    toolName: "read",
    value: { text: "contents" },
  });
  assert.equal(prompted, false);
  assert.equal(executed, true);
});

test("denies a child action matching a deny rule before execution", async () => {
  let executed = false;
  const boundary: ToolPermissionBoundary = {
    evaluate: async () => "deny",
    execute: async () => {
      executed = true;
    },
  };

  const result = await executeToolRequest(request({ toolName: "bash" }), boundary);

  assert.equal(result.status, "denied");
  assert.match(result.reason ?? "", /permission/i);
  assert.equal(executed, false);
});

test("asks for an unlisted action and executes only after approval", async () => {
  let promptedRequest: ToolRequest | undefined;
  const boundary: ToolPermissionBoundary = {
    evaluate: async () => "ask",
    prompt: async (toolRequest) => {
      promptedRequest = toolRequest;
      return "allow";
    },
    execute: async (toolRequest) => ({ cwd: toolRequest.cwd, input: toolRequest.input }),
  };

  const result = await executeToolRequest(request(), boundary);

  assert.deepEqual(result, {
    status: "allowed",
    actor: { kind: "child", childId: "amber-otter" },
    toolName: "read",
    value: { cwd: "/workspace/project", input: { path: "notes.md" } },
  });
  assert.deepEqual(promptedRequest, request());
});

test("fails closed when an unlisted action has no permission UI", async () => {
  let executed = false;
  const boundary: ToolPermissionBoundary = {
    evaluate: async () => "ask",
    execute: async () => {
      executed = true;
    },
  };

  const result = await executeToolRequest(request(), boundary);

  assert.equal(result.status, "denied");
  assert.match(result.reason ?? "", /UI|prompt|permission/i);
  assert.equal(executed, false);
});

test("returns cancellation without evaluating or executing a child action", async () => {
  const controller = new AbortController();
  let evaluated = false;
  let executed = false;
  const boundary: ToolPermissionBoundary = {
    evaluate: async () => {
      evaluated = true;
      return "allow";
    },
    execute: async () => {
      executed = true;
    },
  };
  controller.abort();

  const result = await executeToolRequest(request(), boundary, controller.signal);

  assert.equal(result.status, "cancelled");
  assert.equal(evaluated, false);
  assert.equal(executed, false);
});

test("returns a structured failure when the authorized child action crashes", async () => {
  const audit: string[] = [];
  const boundary: ToolPermissionBoundary = {
    evaluate: async () => "allow",
    execute: async () => {
      throw new Error("child tool crashed");
    },
    audit: (entry) => audit.push(`${entry.actor.kind}:${entry.decision}:${entry.toolName}`),
  };

  const result = await executeToolRequest(request(), boundary);

  assert.equal(result.status, "failed");
  assert.match(result.reason ?? "", /child tool crashed/);
  assert.deepEqual(audit, ["child:allow:read", "child:failed:read"]);
});

test("audits the decision and preserves actor, cwd, and steering context", async () => {
  const entries: Array<Record<string, unknown>> = [];
  const toolRequest = request({ toolName: "write", steering: "Update the report." });
  const boundary: ToolPermissionBoundary = {
    evaluate: async (received) => {
      entries.push({ phase: "evaluate", ...received });
      return "deny";
    },
    execute: async () => undefined,
    audit: (entry) => entries.push({ phase: "audit", ...entry }),
  };

  await executeToolRequest(toolRequest, boundary);

  assert.deepEqual(entries, [
    { phase: "evaluate", ...toolRequest },
    {
      phase: "audit",
      actor: { kind: "child", childId: "amber-otter" },
      toolName: "write",
      cwd: "/workspace/project",
      decision: "deny",
      reason: "Permission denied.",
    },
  ]);
});

test("does not auto-allow an in-project read symlink that resolves outside the child cwd", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-permission-symlink-read-"));
  const cwd = join(root, "project");
  const outside = join(root, "outside");
  mkdirSync(cwd);
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "secret", "utf8");
  symlinkSync(outside, join(cwd, "escape"), process.platform === "win32" ? "junction" : "dir");
  let executed = false;
  const toolRequest = request({ cwd, input: { path: "escape/secret.txt" } });
  const options = {
    userPermissionsPath: join(root, "missing-permissions.toml"),
    trustResolver: () => null,
  };
  const boundary: ToolPermissionBoundary = {
    evaluate: async (received) => resolvePermissionDecisionForRequest(received, options),
    execute: async () => { executed = true; },
  };

  const result = await executeToolRequest(toolRequest, boundary);

  assert.equal(result.status, "denied");
  assert.equal(executed, false);
});

test("executes an allowed nonexistent write through the same canonical parent used by policy", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-permission-symlink-write-"));
  const cwd = join(root, "project");
  const outside = join(root, "outside");
  const policy = join(root, "permissions.toml");
  mkdirSync(cwd);
  mkdirSync(outside);
  symlinkSync(outside, join(cwd, "escape"), process.platform === "win32" ? "junction" : "dir");
  writeFileSync(policy, stringifyToml({
    permissions: { write: { allow: [{}], deny: [] } },
  }), "utf8");
  let executedPath: unknown;
  const toolRequest = request({ toolName: "write", cwd, input: { path: "escape/new.txt", content: "safe" } });
  const options = { userPermissionsPath: policy, trustResolver: () => null };
  const boundary: ToolPermissionBoundary = {
    evaluate: async (received) => resolvePermissionDecisionForRequest(received, options),
    execute: async (received) => {
      executedPath = (received.input as { path?: unknown }).path;
    },
  };

  const result = await executeToolRequest(toolRequest, boundary);

  assert.equal(result.status, "allowed");
  assert.equal(executedPath, join(outside, "new.txt"));
});

test("adapts default policy resolution and audit for a child request cwd", async () => {
  const audit: string[] = [];
  let promptedRequest: ToolRequest | undefined;
  const boundary = createToolPermissionBoundary({
    prompt: async (toolRequest) => {
      promptedRequest = toolRequest;
      return "allow";
    },
    audit: (entry) => audit.push(`${entry.actor.kind}:${entry.decision}:${entry.toolName}`),
    execute: async () => "contents",
  });
  const toolRequest = request({ toolName: "child-read-unique-9f7a", cwd: "/workspace/project" });

  const result = await executeToolRequest(toolRequest, boundary);

  assert.equal(result.status, "allowed");
  assert.ok(promptedRequest);
  assert.deepEqual(promptedRequest, toolRequest);
  assert.deepEqual(audit, ["child:allow:child-read-unique-9f7a", "child:executed:child-read-unique-9f7a"]);
});
