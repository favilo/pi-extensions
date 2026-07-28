import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import mcpExtension, { registerMcpProvider } from "./index.ts";
import type { McpToolProvider } from "./registry.ts";

function fakePi() {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> | void }>();
  const tools: string[] = [];
  const messages: string[] = [];
  let activeTools: string[] = [];

  const pi = {
    events: {
      emit(channel: string, data: unknown) {
        for (const handler of handlers.get(channel) ?? []) handler(data);
      },
      on(channel: string, handler: (data: unknown) => void) {
        const channelHandlers = handlers.get(channel) ?? new Set();
        channelHandlers.add(handler);
        handlers.set(channel, channelHandlers);
        return () => channelHandlers.delete(handler);
      },
    },
    on() {},
    registerCommand(name: string, command: { handler(args: string, ctx: unknown): Promise<void> | void }) {
      commands.set(name, command);
    },
    registerTool(tool: { name: string }) {
      tools.push(tool.name);
      activeTools.push(tool.name);
    },
    getActiveTools: () => activeTools,
    setActiveTools(names: string[]) {
      activeTools = names;
    },
    sendMessage(message: { content: string }) {
      messages.push(message.content);
    },
  };

  return { pi: pi as unknown as ExtensionAPI, commands, tools, messages, activeTools: () => activeTools };
}

const mockProvider: McpToolProvider = {
  id: "mock",
  name: "Mock provider",
  tools: [
    {
      name: "mcp__mock__ping",
      label: "mock ping",
      description: "Return a mock response",
      parameters: { type: "object", properties: {}, additionalProperties: false } as never,
      async execute() {
        return { content: [{ type: "text", text: "pong" }], details: {} };
      },
    },
  ],
  getStatusSections: () => [{ title: "Mock server", lines: ["ready"] }],
};

test("the package explicitly loads the shared MCP extension", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as {
    pi?: { extensions?: string[] };
  };

  assert.ok(packageJson.pi?.extensions?.includes("./extensions/mcp/index.ts"));
});

test("a provider contributes a callable tool and named /mcp status section", async () => {
  const harness = fakePi();
  mcpExtension(harness.pi);
  registerMcpProvider(harness.pi, mockProvider);

  await harness.commands.get("mcp")?.handler("", {});

  assert.deepEqual(harness.tools, ["mcp__mock__ping"]);
  assert.equal(harness.messages.length, 1);
  assert.match(harness.messages[0], /Mock provider/);
  assert.match(harness.messages[0], /Mock server/);
  assert.match(harness.messages[0], /ready/);
});

test("a duplicate provider identity is visible without replacing the healthy provider", async () => {
  const harness = fakePi();
  mcpExtension(harness.pi);
  registerMcpProvider(harness.pi, mockProvider);
  registerMcpProvider(harness.pi, {
    ...mockProvider,
    name: "Conflicting provider",
    tools: [],
  });

  await harness.commands.get("mcp")?.handler("", {});

  assert.deepEqual(harness.tools, ["mcp__mock__ping"]);
  assert.match(harness.messages.at(-1) ?? "", /Conflicting provider/);
  assert.match(harness.messages.at(-1) ?? "", /Provider failure/);
  assert.match(harness.messages.at(-1) ?? "", /Mock provider/);
  assert.match(harness.messages.at(-1) ?? "", /Mock server/);
});

test("disposing a rejected duplicate preserves the accepted provider", async () => {
  const harness = fakePi();
  mcpExtension(harness.pi);
  const disposeAccepted = registerMcpProvider(harness.pi, mockProvider);
  const disposeRejected = registerMcpProvider(harness.pi, {
    ...mockProvider,
    name: "Conflicting provider",
    tools: [],
  });

  disposeRejected();
  await harness.commands.get("mcp")?.handler("", {});

  assert.deepEqual(harness.activeTools(), ["mcp__mock__ping"]);
  assert.doesNotMatch(harness.messages.at(-1) ?? "", /Provider failure/);
  assert.match(harness.messages.at(-1) ?? "", /Mock server/);

  disposeAccepted();
  assert.deepEqual(harness.activeTools(), []);
});
