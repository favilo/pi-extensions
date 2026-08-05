import assert from "node:assert/strict";
import test from "node:test";
import { createSubagentSession, executeChildToolRequest } from "./agent-session.ts";
import type { ToolPermissionBoundary, ToolRequest } from "../tool-permissions/permission-boundary.ts";

function childRequest(overrides: Partial<Omit<ToolRequest, "actor">> = {}) {
  return {
    childId: "amber-otter",
    toolName: "read",
    input: { path: "notes.md" },
    cwd: "/workspace/child",
    steering: "Inspect the notes.",
    ...overrides,
  };
}

test("does not expose direct SDK or process execution on a child session", async () => {
  const session = await createSubagentSession(process.cwd());

  try {
    assert.equal("execute" in session, false);
    assert.equal("spawn" in session, false);
    assert.equal("bash" in session, false);
  } finally {
    session.dispose();
  }
});

test("routes process-shaped child requests through the boundary instead of executing them directly", async () => {
  let executed = false;
  const boundary: ToolPermissionBoundary = {
    evaluate: async (request) => {
      assert.equal(request.toolName, "bash");
      assert.deepEqual(request.input, { command: "cat notes.md" });
      return "deny";
    },
    execute: async () => {
      executed = true;
      return undefined;
    },
  };

  const result = await executeChildToolRequest(childRequest({
    toolName: "bash",
    input: { command: "cat notes.md" },
  }), boundary);

  assert.equal(result.status, "denied");
  assert.equal(executed, false);
});

test("adapts a child tool call to the shared boundary actor and preserves context", async () => {
  let received: ToolRequest | undefined;
  const boundary: ToolPermissionBoundary = {
    evaluate: async (request) => {
      received = request;
      return "allow";
    },
    execute: async (request) => ({ input: request.input, cwd: request.cwd }),
  };

  const result = await executeChildToolRequest(childRequest(), boundary);

  assert.deepEqual(received, {
    actor: { kind: "child", childId: "amber-otter" },
    toolName: "read",
    input: { path: "notes.md" },
    cwd: "/workspace/child",
    steering: "Inspect the notes.",
  });
  assert.deepEqual(result, {
    status: "allowed",
    actor: { kind: "child", childId: "amber-otter" },
    toolName: "read",
    value: { input: { path: "notes.md" }, cwd: "/workspace/child" },
  });
});
