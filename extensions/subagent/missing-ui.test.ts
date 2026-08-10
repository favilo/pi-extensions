import assert from "node:assert/strict";
import test from "node:test";
import { executeToolRequest, type ToolPermissionBoundary } from "../tool-permissions/permission-boundary.ts";

test("returns a structured unavailable-UI denial without executing", async () => {
  let executed = false;
  const boundary: ToolPermissionBoundary = {
    evaluate: async () => "ask",
    execute: async () => {
      executed = true;
    },
  };

  const result = await executeToolRequest({
    actor: { kind: "child", childId: "amber-otter" },
    toolName: "read",
    input: { path: "private-notes.md", token: "must-not-leak" },
    cwd: "/workspace/project",
    steering: "Inspect the notes.",
  }, boundary);

  assert.deepEqual(result, {
    status: "denied",
    actor: { kind: "child", childId: "amber-otter" },
    toolName: "read",
    reason: "unavailable_ui",
    cwd: "/workspace/project",
    summary: "read requires interactive approval.",
    steering: "Inspect the notes.",
  });
  assert.equal(executed, false);
  assert.doesNotMatch(JSON.stringify(result), /private-notes|must-not-leak/);
});

test("reports prompt cancellation distinctly without executing", async () => {
  let executed = false;
  const decisions: string[] = [];
  const boundary = {
    evaluate: async () => "ask" as const,
    prompt: async () => "cancel" as const,
    execute: async () => {
      executed = true;
    },
    audit: (entry: { decision: string }) => decisions.push(entry.decision),
  };

  const result = await executeToolRequest({
    actor: { kind: "child", childId: "amber-otter" },
    toolName: "write",
    input: { path: "report.md" },
    cwd: "/workspace/project",
    steering: "Update the report.",
  }, boundary);

  assert.equal(result.status, "cancelled");
  assert.equal(result.reason, "permission_prompt_cancelled");
  assert.equal(executed, false);
  assert.deepEqual(decisions, ["cancel_prompt"]);
});
