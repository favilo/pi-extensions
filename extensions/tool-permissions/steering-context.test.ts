import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stringify as stringifyToml } from "smol-toml";

type ToolCallHandler = (event: { toolName: string; toolCallId?: string; input: Record<string, unknown> }, ctx: unknown) => Promise<unknown>;

type PromptComponent = { handleInput(data: string): void; render(width: number): string[] };

type Harness = {
  toolCall: ToolCallHandler;
  steerMessages: Array<{ text: string; options: unknown }>;
  prompts: PromptComponent[];
  project: string;
  cleanup: () => void;
};

const theme = new Proxy({}, {
  get: () => (...args: unknown[]) => String(args[args.length - 1]),
});

async function steeringHarness(): Promise<Harness> {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-steering-agent-"));
  writeFileSync(join(agentDir, "permissions.toml"), stringifyToml({ permissions: {} }));
  const project = mkdtempSync(join(tmpdir(), "pi-steering-project-"));

  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const handlers = new Map<string, ToolCallHandler>();
  const steerMessages: Array<{ text: string; options: unknown }> = [];
  const prompts: PromptComponent[] = [];
  const { default: toolPermissionPolicy } = await import(`./index.ts?steering-context=${encodeURIComponent(agentDir)}`);
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

function promptingCtx(harness: Harness): unknown {
  return {
    cwd: harness.project,
    hasUI: true,
    mode: "tui",
    sessionId: "steering-context-test",
    ui: {
      notify() {},
      custom(factory: (tui: unknown, t: unknown, kb: unknown, finish: (result: unknown) => void) => PromptComponent) {
        return new Promise((resolve) => {
          const component = factory({ requestRender() {} }, theme, {}, resolve);
          harness.prompts.push(component);
        });
      },
    },
  };
}

function typeText(text: string): string[] {
  return [...text];
}

const TAB = "\t";
const CTRL_D = "\x04";
const CTRL_Y = "\x19";

test("allow-with-steering binds the steer message to the toolCallId", async () => {
  const harness = await steeringHarness();
  try {
    const pending = harness.toolCall(
      { toolName: "bash", toolCallId: "call_test_123", input: { command: "npm test" } },
      promptingCtx(harness),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.prompts.length, 1);

    for (const key of [TAB, ...typeText("only this once"), CTRL_Y]) harness.prompts[0].handleInput(key);
    await pending;

    assert.equal(harness.steerMessages.length, 1);
    const message = harness.steerMessages[0].text;
    assert.match(message, /call_test_123/, "steer message must carry the toolCallId it steers");
    assert.match(message, /only this once/);
    assert.doesNotMatch(message, /npm test/, "the invocation summary costs tokens; the id is the binding");
    assert.deepEqual(harness.steerMessages[0].options, { deliverAs: "steer" });
  } finally {
    harness.cleanup();
  }
});

test("parallel prompts never share steering context", async () => {
  const harness = await steeringHarness();
  try {
    const first = harness.toolCall(
      { toolName: "bash", input: { command: "npm test" } },
      promptingCtx(harness),
    );
    await new Promise((resolve) => setImmediate(resolve));
    const second = harness.toolCall(
      { toolName: "bash", input: { command: "npm run build" } },
      promptingCtx(harness),
    );

    // The queue serializes prompts: only the first is presented so far.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.prompts.length, 1);

    // Deny the first with steering; the reason embeds in ITS result only.
    for (const key of [TAB, ...typeText("not the test command"), CTRL_D]) harness.prompts[0].handleInput(key);
    const firstResult = await first;

    // The second prompt is presented next, with pristine steering state.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.prompts.length, 2);
    harness.prompts[1].handleInput(CTRL_D);
    const secondResult = await second;

    assert.deepEqual(firstResult, {
      block: true,
      reason: "User denied bash command. (reason: not the test command)",
    });
    assert.deepEqual(secondResult, { block: true, reason: "User denied bash command." });
  } finally {
    harness.cleanup();
  }
});
