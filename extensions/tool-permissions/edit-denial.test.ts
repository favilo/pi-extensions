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
  steerMessages: Array<{ text: string; options: unknown }>;
  project: string;
  cleanup: () => void;
};

// Identity theme: strip colors/formatting so the prompt component renders plainly.
const theme = new Proxy({}, {
  get: () => (...args: unknown[]) => String(args[args.length - 1]),
});

async function denialHarness(): Promise<Harness> {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-edit-denial-agent-"));
  writeFileSync(join(agentDir, "permissions.toml"), stringifyToml({ permissions: {} }));
  const project = mkdtempSync(join(tmpdir(), "pi-edit-denial-project-"));
  writeFileSync(join(project, "file.txt"), "alpha\nbeta\n");

  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const handlers = new Map<string, ToolCallHandler>();
  const steerMessages: Array<{ text: string; options: unknown }> = [];
  const { default: toolPermissionPolicy } = await import(`./index.ts?edit-denial=${encodeURIComponent(agentDir)}`);
  toolPermissionPolicy({
    registerCommand() {},
    on(event: string, handler: ToolCallHandler) {
      if (event === "tool_call") handlers.set(event, handler);
    },
    getAllTools: () => [],
    sendUserMessage(text: string, options: unknown) {
      steerMessages.push({ text, options });
    },
  } as never);

  return {
    toolCall: handlers.get("tool_call")!,
    steerMessages,
    project,
    cleanup: () => {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      rmSync(agentDir, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    },
  };
}

type PromptComponent = { handleInput(data: string): void; render(width: number): string[] };

/** A ctx whose TUI prompt captures the component and feeds it the given key inputs. */
function promptingCtx(project: string, keys: string[]): unknown {
  return {
    cwd: project,
    hasUI: true,
    mode: "tui",
    sessionId: "edit-denial-test",
    ui: {
      notify() {},
      custom(factory: (tui: unknown, t: unknown, kb: unknown, finish: (result: unknown) => void) => PromptComponent) {
        return new Promise((resolve) => {
          const component = factory({ requestRender() {} }, theme, {}, resolve);
          for (const key of keys) component.handleInput(key);
        });
      },
    },
  };
}

function typeText(text: string): string[] {
  return [...text];
}

const VALID_EDIT = () => ({ path: "", edits: [{ oldText: "beta", newText: "BETA" }] });

test("a denied edit without steering blocks with the canonical denial reason", async () => {
  const harness = await denialHarness();
  try {
    const input = { ...VALID_EDIT(), path: join(harness.project, "file.txt") };
    // Ctrl+D at the prompt: deny without steering text.
    const result = await harness.toolCall(
      { toolName: "edit", input },
      promptingCtx(harness.project, ["\x04"]),
    );

    assert.deepEqual(result, { block: true, reason: "User denied edit." });
    assert.deepEqual(harness.steerMessages, []);
  } finally {
    harness.cleanup();
  }
});

test("a denied edit with steering delivers the reason to the agent as a steer message", async () => {
  const harness = await denialHarness();
  try {
    const input = { ...VALID_EDIT(), path: join(harness.project, "file.txt") };
    // Tab enters steering mode, type the reason, Ctrl+D denies with steering.
    const result = await harness.toolCall(
      { toolName: "edit", input },
      promptingCtx(harness.project, ["\t", ...typeText("do not touch this file"), "\x04"]),
    );

    assert.deepEqual(result, { block: true, reason: "User denied edit." });
    assert.deepEqual(harness.steerMessages, [
      { text: "do not touch this file", options: { deliverAs: "steer" } },
    ]);
  } finally {
    harness.cleanup();
  }
});
