import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import subagentExtension, { createChildToolDefinitions } from "./index.ts";

test("registers the subagent launch tool", () => {
  const tools: Array<{ name: string }> = [];
  const pi = {
    registerTool(tool: { name: string }) {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI;

  subagentExtension(pi);

  assert.deepEqual(tools.map(({ name }) => name), ["subagent"]);
});

test("gives a child only the permission bridge tool", () => {
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
  }
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
