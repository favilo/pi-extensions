import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import subagentExtension, { createChildToolDefinitions } from "./index.ts";

test("registers background launch, explicit result lookup, ctrl+tab shortcut, and shutdown cleanup", () => {
  const tools: Array<{
    name: string;
    execute?: (toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
    renderCall?: unknown;
    renderResult?: (result: unknown, options: { expanded: boolean; isPartial: boolean }, theme: unknown) => { render(width: number): string[] };
  }> = [];
  const events: string[] = [];
  const shortcuts: string[] = [];
  const pi = {
    registerTool(tool: { name: string }) {
      tools.push(tool);
    },
    registerShortcut(shortcut: string) {
      shortcuts.push(shortcut);
    },
    on(event: string) {
      events.push(event);
    },
    sendMessage() {},
  } as unknown as ExtensionAPI;

  subagentExtension(pi);

  assert.deepEqual(tools.map(({ name }) => name), ["subagent", "subagent_result"]);
  assert.deepEqual(shortcuts, ["ctrl+tab", "alt+t", "alt+shift+t"]);
  assert.deepEqual(events, ["message_start", "agent_settled", "session_shutdown"]);

  const resultTool = tools.find(({ name }) => name === "subagent_result");
  assert.equal(typeof resultTool?.renderCall, "function");
  assert.equal(typeof resultTool?.renderResult, "function");

  const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
  const result = {
    content: [{ type: "text", text: "model-facing result" }],
    details: {
      found: true,
      id: "child-1234",
      cwd: "/workspace",
      status: "completed",
      terminal: true,
      output: "visible only when expanded",
      outputBytes: { original: 26, returned: 26 },
      outputTruncated: false,
    },
  };
  const collapsed = resultTool?.renderResult?.(result, { expanded: false, isPartial: false }, theme)?.render(160).join("\n") ?? "";
  const expanded = resultTool?.renderResult?.(result, { expanded: true, isPartial: false }, theme)?.render(160).join("\n") ?? "";

  assert.match(collapsed, /completed.*26 bytes/i);
  assert.doesNotMatch(collapsed, /visible only when expanded/);
  assert.match(expanded, /visible only when expanded/);
});

test("launching a subagent sets UI status, widget, and registers child panel in PanelManager", async () => {
  const tools: Array<{
    name: string;
    execute?: (toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
  }> = [];
  const commands: Map<string, (args: string, ctx: unknown) => Promise<void>> = new Map();
  const statuses = new Map<string, string | undefined>();
  const widgets = new Map<string, string[] | undefined>();

  const pi = {
    registerTool(tool: { name: string }) {
      tools.push(tool);
    },
    registerShortcut() {},
    registerCommand(name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) {
      commands.set(name, options.handler);
    },
    on() {},
    sendMessage() {},
  } as unknown as ExtensionAPI;

  subagentExtension(pi);

  const subagentTool = tools.find(({ name }) => name === "subagent");
  assert.ok(subagentTool?.execute);

  const ctx = {
    cwd: process.cwd(),
    hasUI: true,
    mode: "tui",
    getSystemPrompt: () => "parent policy prompt",
    sessionManager: {
      getSessionFile: () => undefined,
      getSessionDir: () => "/tmp",
    },
    ui: {
      setStatus: (key: string, text: string | undefined) => { statuses.set(key, text); },
      setWidget: (key: string, content: string[] | undefined) => { widgets.set(key, content); },
      notify() {},
    },
  };

  let createSessionCalled = false;
  const launchResult = await subagentTool.execute("launch-1", {
    task: "inspect repo",
    createSession: async () => {
      createSessionCalled = true;
      return {
        sessionId: "child-mock-1234",
        prompt: async () => {},
        subscribe: () => () => {},
        dispose: () => {},
      };
    },
  }, undefined, undefined, ctx) as { details: { id: string } };
  assert.ok(launchResult.details.id);
  assert.equal(createSessionCalled, true, "launch must use the injected createSession seam");

  assert.match(statuses.get("subagent") ?? "", /Subagent running/);
  assert.equal((widgets.get("subagent") ?? []).length > 0, true);

  const panelsHandler = commands.get("subagent:panels");
  assert.ok(panelsHandler);

  let notifiedMessage = "";
  let customRenderedLines: string[] = [];
  const panelsCtx = {
    ...ctx,
    ui: {
      ...ctx.ui,
      notify: (msg: string) => { notifiedMessage = msg; },
      custom: async (factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (res: unknown) => void) => { render(width: number): string[]; dispose?(): void }) => {
        const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
        const component = await factory({ requestRender() {} }, theme, {}, () => {});
        customRenderedLines = component.render(80);
      },
      onTerminalInput: () => () => {},
    },
  };

  await panelsHandler("next", panelsCtx);
  assert.match(notifiedMessage, new RegExp(launchResult.details.id));
  assert.equal(customRenderedLines.length > 0, true);
  assert.match(customRenderedLines.join("\n"), new RegExp(`Subagent ${launchResult.details.id}`));
});

test("forwards an already-cancelled launch invocation before constructing a child session", async () => {
  const tools: Array<{
    name: string;
    execute?: (toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
  }> = [];
  const pi = {
    registerTool(tool: { name: string }) {
      tools.push(tool);
    },
    on() {},
    sendMessage() {},
  } as unknown as ExtensionAPI;
  subagentExtension(pi);
  const launchTool = tools.find(({ name }) => name === "subagent");
  const invocation = new AbortController();
  invocation.abort();
  assert.ok(launchTool?.execute);

  await assert.rejects(
    launchTool.execute("launch-cancelled", { task: "do not start" }, invocation.signal, undefined, {
      cwd: process.cwd(),
      getSystemPrompt: () => "policy",
      sessionManager: {
        getSessionFile: () => undefined,
        getSessionDir: () => "/tmp",
      },
    }),
    /cancel/i,
  );
});

test("gives a child only the permission bridge tool with structured object arguments", () => {
  const boundary = {
    evaluate: async () => "deny" as const,
    prompt: async () => "deny" as const,
    execute: async () => ({ ok: true }),
    audit: () => {},
  } as never;

  const tools = createChildToolDefinitions("worker-1", "/workspace", boundary);

  assert.deepEqual(tools.map((tool) => tool.name), ["subagent-tool-request"]);
  for (const tool of tools) {
    assert.equal((tool.parameters as { type?: string }).type, "object");
    assert.equal(typeof tool.execute, "function");
    assert.equal(typeof tool.renderCall, "function");
  }
  const parameters = tools[0].parameters as {
    properties?: { input?: { type?: string; description?: string } };
  };
  assert.equal(parameters.properties?.input?.type, "object");
  assert.match(parameters.properties?.input?.description ?? "", /not a JSON-encoded string/i);
});

test("does not invoke the underlying tool when the boundary denies", async () => {
  let executed = false;
  const boundary = {
    evaluate: async () => "deny" as const,
    prompt: async () => "deny" as const,
    execute: async () => {
      executed = true;
      return { ok: true };
    },
    audit: () => {},
  } as never;

  const bridge = createChildToolDefinitions("worker-denied", "/workspace", boundary)[0];
  const result = await bridge.execute("call-1", { toolName: "read", input: { path: "secret.txt" } }, new AbortController().signal, undefined, {} as never);

  assert.equal(executed, false);
  assert.match(JSON.stringify(result.details), /deny|denied/i);
});

test("executes the ordinary tool only after the boundary allows it", async () => {
  const auditEntries: unknown[] = [];
  const boundary = {
    evaluate: async () => "allow" as const,
    prompt: async () => "deny" as const,
    execute: async (request: { toolName: string; input: unknown; cwd: string }) => {
      auditEntries.push(request);
      return { ok: true };
    },
    audit: () => {},
  } as never;

  const bridge = createChildToolDefinitions("worker-allowed", "/workspace", boundary)[0];
  await bridge.execute("call-2", { toolName: "read", input: { path: "notes.md" } }, new AbortController().signal, undefined, {} as never);

  assert.equal(auditEntries.length, 1);
  assert.deepEqual((auditEntries[0] as { toolName: string }).toolName, "read");
});
