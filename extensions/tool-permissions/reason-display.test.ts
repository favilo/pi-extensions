import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stringify as stringifyToml } from "smol-toml";

type ToolCallHandler = (event: { toolName: string; input: Record<string, unknown> }, ctx: unknown) => Promise<unknown>;

type Harness = {
  toolCall: ToolCallHandler;
  prompts: Array<{ title: string; body: string }>;
  project: string;
  cleanup: () => void;
};

async function reasonHarness(): Promise<Harness> {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-reason-agent-"));
  writeFileSync(join(agentDir, "permissions.toml"), stringifyToml({ permissions: {} }));
  const project = mkdtempSync(join(tmpdir(), "pi-reason-project-"));
  writeFileSync(join(project, "file.txt"), "alpha\nbeta\n");

  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const handlers = new Map<string, ToolCallHandler>();
  const prompts: Array<{ title: string; body: string }> = [];
  const { default: toolPermissionPolicy } = await import(`./index.ts?reason-display=${encodeURIComponent(agentDir)}`);
  toolPermissionPolicy({
    registerCommand() {},
    on(event: string, handler: ToolCallHandler) {
      if (event === "tool_call") handlers.set(event, handler);
    },
    getAllTools: () => [],
  } as never);

  return {
    toolCall: handlers.get("tool_call")!,
    prompts,
    project,
    cleanup: () => {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      rmSync(agentDir, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    },
  };
}

function confirmingCtx(project: string, prompts: Array<{ title: string; body: string }>): unknown {
  return {
    cwd: project,
    hasUI: true,
    mode: "json",
    sessionId: "reason-display-test",
    ui: {
      notify() {},
      confirm: (title: string, body: string) => {
        prompts.push({ title, body });
        return Promise.resolve(false);
      },
    },
  };
}

test("an edit request with a reason shows it in the permission prompt", async () => {
  const harness = await reasonHarness();
  try {
    await harness.toolCall(
      { toolName: "edit", input: { path: join(harness.project, "file.txt"), edits: [{ oldText: "beta", newText: "BETA" }], reason: "normalize casing before the rename" } },
      confirmingCtx(harness.project, harness.prompts),
    );

    assert.equal(harness.prompts.length, 1);
    assert.match(harness.prompts[0].body, /normalize casing before the rename/);
  } finally {
    harness.cleanup();
  }
});

test("a bash request with a reason shows it in the permission prompt", async () => {
  const harness = await reasonHarness();
  try {
    await harness.toolCall(
      { toolName: "bash", input: { command: "npm test", reason: "verify the refactor is green" } },
      confirmingCtx(harness.project, harness.prompts),
    );

    assert.equal(harness.prompts.length, 1);
    assert.match(harness.prompts[0].body, /verify the refactor is green/);
  } finally {
    harness.cleanup();
  }
});

test("a request without a reason renders no reason line", async () => {
  const harness = await reasonHarness();
  try {
    await harness.toolCall(
      { toolName: "edit", input: { path: join(harness.project, "file.txt"), edits: [{ oldText: "beta", newText: "BETA" }] } },
      confirmingCtx(harness.project, harness.prompts),
    );

    assert.equal(harness.prompts.length, 1);
    assert.doesNotMatch(harness.prompts[0].body, /[Rr]eason:/);
  } finally {
    harness.cleanup();
  }
});
