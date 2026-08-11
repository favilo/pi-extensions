import assert from "node:assert/strict";
import test from "node:test";
import { createToolPermissionBoundary } from "./index.ts";
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
