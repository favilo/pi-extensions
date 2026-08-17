import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import contextRouter from "./index.ts";

type RegisteredTool = {
  name: string;
  execute?: (
    toolCallId: string,
    input: { query: string; select?: string[] },
    signal: AbortSignal,
    onUpdate: undefined,
    ctx: unknown,
  ) => Promise<{ details: unknown }>;
};

type ToolInfo = { name: string; description?: string; sourceInfo?: { source?: string }; parameters?: unknown };
type Handler = () => void | Promise<void>;

function routerHarness(initial: ToolInfo[]) {
  const tools = new Map<string, RegisteredTool>();
  const handlers = new Map<string, Handler[]>();
  const allTools = [...initial];
  let activeTools = initial.map(({ name }) => name);
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerTool(tool: RegisteredTool) {
      tools.set(tool.name, tool);
      allTools.push({ name: tool.name, description: tool.name, sourceInfo: { source: "extension" } });
      activeTools.push(tool.name);
    },
    getAllTools: () => allTools,
    getActiveTools: () => activeTools,
    setActiveTools(names: string[]) {
      activeTools = names;
    },
  } as unknown as ExtensionAPI;

  contextRouter(pi);

  return {
    activeTools: () => activeTools,
    addLateTool(tool: ToolInfo) {
      allTools.push(tool);
      activeTools.push(tool.name);
    },
    removeTool(name: string) {
      const index = allTools.findIndex((tool) => tool.name === name);
      if (index !== -1) allTools.splice(index, 1);
    },
    finder: () => tools.get("find_tools"),
    async emit(event: string) {
      for (const handler of handlers.get(event) ?? []) await handler();
    },
  };
}

test("router establishes and maintains only the baseline plus deliberate selected parent tools", async () => {
  const harness = routerHarness([
    { name: "read", description: "Read files", sourceInfo: { source: "builtin" } },
    { name: "bash", description: "Run commands", sourceInfo: { source: "builtin" } },
    { name: "edit", description: "Edit files", sourceInfo: { source: "builtin" } },
    { name: "write", description: "Write files", sourceInfo: { source: "builtin" } },
    { name: "grep", description: "Search text", sourceInfo: { source: "builtin" } },
    { name: "find", description: "Find files", sourceInfo: { source: "builtin" } },
    { name: "ls", description: "List files", sourceInfo: { source: "builtin" } },
    { name: "subagent", description: "Launch a child", sourceInfo: { source: "extension" } },
    { name: "subagent_result", description: "Read a child result", sourceInfo: { source: "extension" } },
    { name: "mcp__deploy", description: "Deploy a service", sourceInfo: { source: "mcp" }, parameters: { secret: "hidden" } },
  ]);

  await harness.emit("session_start");
  assert.deepEqual(harness.activeTools(), [
    "read", "bash", "edit", "write", "grep", "find", "ls", "subagent", "find_tools", "find_skills",
  ]);

  harness.addLateTool({ name: "mcp__late", description: "Late provider", sourceInfo: { source: "mcp" } });
  await harness.emit("turn_start");
  assert.doesNotMatch(harness.activeTools().join(","), /subagent_result|mcp__late|mcp__deploy/);

  const finder = harness.finder();
  assert.ok(finder?.execute);
  const result = await finder.execute("find-deploy", { query: "deploy", select: ["mcp__deploy"] }, new AbortController().signal, undefined, {});
  assert.deepEqual(result.details, { matches: ["mcp__deploy"], added: ["mcp__deploy"] });
  assert.ok(harness.activeTools().includes("mcp__deploy"));

  await harness.emit("turn_start");
  assert.ok(harness.activeTools().includes("mcp__deploy"));
  harness.removeTool("mcp__deploy");
  await harness.emit("turn_start");
  assert.ok(!harness.activeTools().includes("mcp__deploy"));

  await harness.emit("session_shutdown");
  await harness.emit("session_start");
  assert.deepEqual(harness.activeTools(), [
    "read", "bash", "edit", "write", "grep", "find", "ls", "subagent", "find_tools", "find_skills",
  ]);
});
