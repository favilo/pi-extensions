import assert from "node:assert/strict";
import test from "node:test";
import { executeChildToolRequest } from "./agent-session.ts";
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
