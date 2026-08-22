import "../../extensions/test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import mcpExtension from "../../extensions/mcp/index.ts";
import exampleMcpProvider from "./index.ts";

function harness() {
  const events = new Map<string, Set<(data: unknown) => void>>();
  const lifecycle = new Map<string, Array<() => void>>();
  const commands = new Map<string, { handler(args: string, ctx: unknown): Promise<void> | void }>();
  const tools = new Map<string, ToolDefinition<any, any, any>>();
  const messages: string[] = [];
  const emitted: Array<{ channel: string; data: unknown }> = [];
  let active: string[] = [];
  const pi = {
    events: {
      emit(channel: string, data: unknown) {
        emitted.push({ channel, data });
        for (const handler of events.get(channel) ?? []) handler(data);
      },
      on(channel: string, handler: (data: unknown) => void) {
        const handlers = events.get(channel) ?? new Set();
        handlers.add(handler);
        events.set(channel, handlers);
        return () => handlers.delete(handler);
      },
    },
    on(name: string, handler: () => void) {
      lifecycle.set(name, [...(lifecycle.get(name) ?? []), handler]);
    },
    registerCommand(name: string, command: { handler(args: string, ctx: unknown): Promise<void> | void }) {
      commands.set(name, command);
    },
    registerTool(tool: ToolDefinition<any, any, any>) {
      tools.set(tool.name, tool);
      active.push(tool.name);
    },
    getActiveTools: () => active,
    setActiveTools(names: string[]) {
      active = names;
    },
    sendMessage(message: { content: string }) {
      messages.push(message.content);
    },
  };
  return { pi: pi as unknown as ExtensionAPI, lifecycle, commands, tools, messages, emitted, active: () => active };
}

test("the machine-local authoring example is decoupled from the registry implementation", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /extensions\/mcp/);
  assert.match(source, /pi-mcp:provider-register/);
  assert.match(source, /pi-mcp:registry-ready/);
});

test("the authoring example demonstrates the public contract without external services", async () => {
  const testHarness = harness();
  mcpExtension(testHarness.pi);
  exampleMcpProvider(testHarness.pi);

  const tool = testHarness.tools.get("mcp__example__echo");
  assert.ok(tool);
  const result = await tool.execute("call-1", { text: "hello" }, undefined, undefined, {} as never);
  assert.equal(result.content[0]?.type === "text" ? result.content[0].text : undefined, "mock: hello");

  await testHarness.commands.get("mcp")?.handler("", {});
  assert.match(testHarness.messages.at(-1) ?? "", /Example healthy server/);
  assert.match(testHarness.messages.at(-1) ?? "", /Example failed server/);

  for (const shutdown of testHarness.lifecycle.get("session_shutdown") ?? []) shutdown();
  assert.deepEqual(testHarness.active(), []);
  const unregistration = [...testHarness.emitted].reverse().find(
    ({ channel }) => channel === "pi-mcp:provider-unregister",
  );
  assert.equal(typeof unregistration?.data, "object");
  assert.equal((unregistration?.data as { id?: string } | undefined)?.id, "example");
});
