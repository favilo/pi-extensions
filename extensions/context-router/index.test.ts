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
type Handler = (event?: unknown) => void | Promise<unknown>;

function routerHarness(initial: ToolInfo[]) {
  const tools = new Map<string, RegisteredTool>();
  const handlers = new Map<string, Handler[]>();
  const allTools = [...initial];
  let activeTools = initial.map(({ name }) => name);
  let lastSystemPrompt = "SYSTEM PROMPT";
  let lastBeforeAgentResult: { systemPrompt?: string } | undefined;
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerCommand() {},
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
    async emit(event: string, eventData?: unknown) {
      for (const handler of handlers.get(event) ?? []) {
        const result = await handler(eventData);
        if (event === "before_agent_start" && result && typeof result === "object") {
          lastBeforeAgentResult = result as { systemPrompt?: string };
          if ((result as { systemPrompt?: string }).systemPrompt) {
            lastSystemPrompt = (result as { systemPrompt: string }).systemPrompt;
          }
        }
      }
    },
    systemPrompt: () => lastSystemPrompt,
    beforeAgentResult: () => lastBeforeAgentResult,
    toolCallHandlers: () => handlers.get("tool_call") ?? [],
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

test("before_agent_start appends availability section preserving existing prompt", async () => {
  const harness = routerHarness([
    { name: "read", description: "Read files", sourceInfo: { source: "builtin" } },
    { name: "bash", description: "Run commands", sourceInfo: { source: "builtin" } },
    { name: "subagent", description: "Launch a child", sourceInfo: { source: "extension" } },
    { name: "subagent_result", description: "Read a child result", sourceInfo: { source: "extension" } },
    { name: "mcp__deploy", description: "Deploy a service", sourceInfo: { source: "mcp" } },
  ]);

  const skills = [
    { name: "deploy", description: "Deploy skill", filePath: "/skills/deploy/SKILL.md" },
  ];

  await harness.emit("session_start");
  await harness.emit("before_agent_start", {
    systemPrompt: "EXISTING PROMPT",
    systemPromptOptions: { skills },
  });

  const result = harness.beforeAgentResult();
  assert.ok(result?.systemPrompt?.startsWith("EXISTING PROMPT"), "must preserve existing prompt");
  assert.match(result?.systemPrompt, /Tools:/);
  assert.match(result?.systemPrompt, /subagent_result/);
  // mcp__deploy should NOT appear in the summary list, only in suppressed
  const suppressedStart = result?.systemPrompt?.indexOf("Suppressed:") ?? -1;
  const summarySection = suppressedStart > 0 ? result?.systemPrompt?.slice(0, suppressedStart) : result?.systemPrompt;
  assert.doesNotMatch(summarySection, /mcp__deploy/, "MCP tool must not appear in summary section");
  assert.match(result?.systemPrompt, /Suppressed:/);
  assert.match(result?.systemPrompt, /mcp__deploy/);
  assert.match(result?.systemPrompt, /Skills:/);
  assert.match(result?.systemPrompt, /deploy/);
});

test("tool_call lazily activates registered but inactive non-MCP tools", async () => {
  const harness = routerHarness([
    { name: "read", description: "Read files", sourceInfo: { source: "builtin" } },
    { name: "subagent_result", description: "Read a child result", sourceInfo: { source: "extension" } },
  ]);

  await harness.emit("session_start");
  assert.ok(!harness.activeTools().includes("subagent_result"));

  const handlers = harness.toolCallHandlers();
  assert.ok(handlers.length > 0, "must have tool_call handler");

  let activated = false;
  for (const handler of handlers) {
    const event = { toolName: "subagent_result", toolCallId: "tc-1", input: {} };
    const result = await handler(event);
    if (!result || (result as { block?: boolean }).block !== true) {
      activated = true;
    }
  }

  assert.ok(activated || harness.activeTools().includes("subagent_result"), "must activate subagent_result");
});
