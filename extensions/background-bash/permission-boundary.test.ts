import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { publishToolDefinition, unpublishToolDefinition } from "../tool-registry/index.ts";
import { registerBackgroundBash } from "./index.ts";
import type { BackgroundBashSpawn } from "./lifecycle.ts";

type ToolResultLike = { content: Array<{ type: string; text?: string }>; details?: unknown; isError?: boolean };
type CapturedTool = {
  name: string;
  execute(toolCallId: string, params: Record<string, unknown>, signal: AbortSignal, onUpdate?: unknown, ctx?: { cwd: string }): Promise<ToolResultLike>;
};

function harness(spawn: BackgroundBashSpawn) {
  const tools = new Map<string, CapturedTool>();
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const foregroundCalls: unknown[] = [];
  const pi = {
    registerTool(tool: CapturedTool) {
      tools.set(tool.name, tool);
    },
    on(event: string, handler: (...args: never[]) => unknown) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;

  publishToolDefinition({
    name: "bash",
    label: "bash",
    description: "foreground bash",
    parameters: { type: "object", properties: {} },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      foregroundCalls.push(params);
      return { content: [{ type: "text", text: "foreground result" }] } as never;
    },
  } as never);

  registerBackgroundBash(pi, { spawn });
  return {
    tools,
    handlers,
    foregroundCalls,
    cleanup: () => unpublishToolDefinition("bash"),
  };
}

test("an authorized background launch returns its task ID before the command settles", async () => {
  const spawned: Array<{ command: string; cwd: string }> = [];
  const { tools, foregroundCalls, cleanup } = harness(({ command, cwd }) => {
    spawned.push({ command, cwd });
    return { terminate() {} };
  });
  try {
    const bash = tools.get("bash")!;
    const result = await bash.execute("call-1", { command: "sleep 60", background: true }, new AbortController().signal, undefined, { cwd: "/workspace" });

    assert.deepEqual(spawned, [{ command: "sleep 60", cwd: "/workspace" }]);
    assert.equal(foregroundCalls.length, 0, "background mode must not run the foreground executor");
    const details = result.details as { id: string; status: string };
    assert.match(details.id, /^bash-/);
    assert.equal(details.status, "running");
    assert.match(result.content[0]!.text!, /bash-/);
  } finally {
    cleanup();
  }
});

test("foreground bash calls keep their existing result shape when background mode is absent", async () => {
  let spawned = false;
  const { tools, foregroundCalls, cleanup } = harness(() => {
    spawned = true;
    return { terminate() {} };
  });
  try {
    const bash = tools.get("bash")!;
    const result = await bash.execute("call-1", { command: "pwd" }, new AbortController().signal, undefined, { cwd: "/workspace" });

    assert.equal(spawned, false);
    assert.deepEqual(foregroundCalls, [{ command: "pwd" }]);
    assert.equal(result.content[0]!.text, "foreground result");
    assert.equal(result.details, undefined);
  } finally {
    cleanup();
  }
});

test("an invalid background request fails without launching a process", async () => {
  let spawned = false;
  const { tools, cleanup } = harness(() => {
    spawned = true;
    return { terminate() {} };
  });
  try {
    const bash = tools.get("bash")!;
    await assert.rejects(
      bash.execute("call-1", { background: true }, new AbortController().signal, undefined, { cwd: "/workspace" }),
      /command/i,
    );
    assert.equal(spawned, false);
  } finally {
    cleanup();
  }
});
