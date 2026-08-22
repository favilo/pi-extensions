import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import mcpExtension, { registerMcpProvider } from "./index.ts";
import type { McpToolProvider } from "./registry.ts";

function harness() {
  const events = new Map<string, Set<(data: unknown) => void>>();
  const lifecycle = new Map<string, Array<() => void>>();
  const registered: string[] = [];
  let active: string[] = [];
  const pi = {
    events: {
      emit(channel: string, data: unknown) {
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
    registerCommand() {},
    registerTool(tool: { name: string }) {
      registered.push(tool.name);
      active.push(tool.name);
    },
    getActiveTools: () => active,
    setActiveTools(names: string[]) {
      active = names;
    },
  };
  return { pi: pi as unknown as ExtensionAPI, registered, active: () => active, lifecycle };
}

const provider: McpToolProvider = {
  id: "lifecycle",
  name: "Lifecycle",
  tools: [
    {
      name: "mcp__lifecycle__ping",
      label: "ping",
      description: "ping",
      parameters: { type: "object", properties: {} } as never,
      async execute() {
        return { content: [{ type: "text", text: "pong" }], details: {} };
      },
    },
  ],
  getStatusSections: () => [],
};

test("provider registration is independent of extension load order", () => {
  const providerFirst = harness();
  const disposeProviderFirst = registerMcpProvider(providerFirst.pi, provider);
  mcpExtension(providerFirst.pi);

  const registryFirst = harness();
  mcpExtension(registryFirst.pi);
  registerMcpProvider(registryFirst.pi, provider);

  assert.deepEqual(providerFirst.registered, ["mcp__lifecycle__ping"]);
  assert.deepEqual(registryFirst.registered, ["mcp__lifecycle__ping"]);
  disposeProviderFirst();
});

test("repeated registry availability does not duplicate provider tools", () => {
  const testHarness = harness();
  mcpExtension(testHarness.pi);
  registerMcpProvider(testHarness.pi, provider);

  testHarness.pi.events.emit("pi-mcp:registry-ready", undefined);

  assert.deepEqual(testHarness.registered, ["mcp__lifecycle__ping"]);
});

test("session shutdown disposes registered providers", () => {
  const testHarness = harness();
  mcpExtension(testHarness.pi);
  let disposed = 0;
  const disposable: McpToolProvider = {
    ...provider,
    id: "disposable",
    dispose() {
      disposed++;
    },
  };
  registerMcpProvider(testHarness.pi, disposable);

  for (const handler of testHarness.lifecycle.get("session_shutdown") ?? []) handler();

  assert.equal(disposed, 1);
});

test("provider removal deactivates its tools", () => {
  const testHarness = harness();
  mcpExtension(testHarness.pi);
  const dispose = registerMcpProvider(testHarness.pi, provider);

  dispose();

  assert.deepEqual(testHarness.active(), []);
});

function replacementHarness() {
  const events = new Map<string, Set<(data: unknown) => void>>();
  let active: string[] = [];

  function createRuntime() {
    const shutdownHandlers: Array<(event: { reason: string }) => void> = [];
    const pi = {
      events: {
        emit(channel: string, data: unknown) {
          for (const handler of events.get(channel) ?? []) handler(data);
        },
        on(channel: string, handler: (data: unknown) => void) {
          const handlers = events.get(channel) ?? new Set();
          handlers.add(handler);
          events.set(channel, handlers);
          return () => handlers.delete(handler);
        },
      },
      on(name: string, handler: (event: { reason: string }) => void) {
        if (name === "session_shutdown") shutdownHandlers.push(handler);
      },
      registerCommand() {},
      registerTool(tool: { name: string }) {
        active.push(tool.name);
      },
      getActiveTools: () => active,
      setActiveTools(names: string[]) {
        active = names;
      },
    } as unknown as ExtensionAPI;

    mcpExtension(pi);
    const disposeProvider = registerMcpProvider(pi, provider);
    pi.on("session_shutdown", disposeProvider);

    return {
      shutdown(reason: string) {
        for (const handler of shutdownHandlers) handler({ reason });
      },
    };
  }

  return {
    createRuntime,
    active: () => active,
    listenerCount: () => [...events.values()].reduce((count, handlers) => count + handlers.size, 0),
  };
}

test("reload, new, resume, fork, and quit clean up runtime-owned provider state", () => {
  for (const reason of ["reload", "new", "resume", "fork", "quit"]) {
    const session = replacementHarness();
    const runtime = session.createRuntime();
    assert.deepEqual(session.active(), ["mcp__lifecycle__ping"]);

    runtime.shutdown(reason);

    assert.deepEqual(session.active(), [], reason);
    assert.equal(session.listenerCount(), 0, reason);
    if (reason !== "quit") {
      session.createRuntime();
      assert.deepEqual(session.active(), ["mcp__lifecycle__ping"], reason);
    }
  }
});

test("100 runtime replacement cycles leave no stale or duplicate tools", () => {
  const session = replacementHarness();

  for (let cycle = 0; cycle < 100; cycle += 1) {
    const runtime = session.createRuntime();
    assert.deepEqual(session.active(), ["mcp__lifecycle__ping"], `cycle ${cycle}`);
    runtime.shutdown("reload");
    assert.deepEqual(session.active(), [], `cycle ${cycle}`);
    assert.equal(session.listenerCount(), 0, `cycle ${cycle}`);
  }
});
