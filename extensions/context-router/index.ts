import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  projectSkillCatalog,
  projectToolCatalog,
  selectCurrentToolMatches,
  type SkillRecord,
  type ToolRecord,
} from "./catalog.ts";
import { buildAvailabilityPrompt, sanitizeSkillsPrompt, type SanitizerOutcome } from "./prompt.ts";

const BASELINE_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "subagent",
  "find_tools",
  "find_skills",
] as const;

type FindToolsInput = { query: string; select?: string[] };
type FindSkillsInput = { query: string };

function currentRegisteredNames(pi: ExtensionAPI): string[] {
  return pi.getAllTools()
    .map((tool) => tool.name)
    .filter((name): name is string => typeof name === "string");
}

function applySessionToolSet(pi: ExtensionAPI, selected: Set<string>): void {
  const registered = new Set(currentRegisteredNames(pi));
  const retainedSelections = [...selected].filter((name) => registered.has(name));
  selected.clear();
  for (const name of retainedSelections) selected.add(name);

  pi.setActiveTools([
    ...BASELINE_TOOLS.filter((name) => registered.has(name)),
    ...retainedSelections,
  ]);
}

function isMcpTool(source: string | undefined, name: string): boolean {
  // MCP tools have source "mcp" or names prefixed with mcp__
  if (source === "mcp") return true;
  if (name.startsWith("mcp__")) return true;
  return false;
}

function buildToolSummaries(allTools: ToolRecord[]): Array<{ name: string; description: string }> {
  const seen = new Set<string>();
  const summaries: Array<{ name: string; description: string }> = [];
  for (const tool of allTools) {
    const name = typeof tool.name === "string" ? tool.name : "";
    const description = typeof tool.description === "string" ? tool.description : "";
    const source = typeof tool.sourceInfo?.source === "string" ? tool.sourceInfo.source : "";
    if (!name || seen.has(name)) continue;
    if (isMcpTool(source, name)) continue;
    seen.add(name);
    summaries.push({ name, description });
  }
  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}

function buildSuppressedTools(allTools: ToolRecord[], activeNames: string[]): string[] {
  const active = new Set(activeNames);
  const suppressed: string[] = [];
  const seen = new Set<string>();
  for (const tool of allTools) {
    const name = typeof tool.name === "string" ? tool.name : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (!active.has(name)) {
      suppressed.push(name);
    }
  }
  return suppressed.sort((a, b) => a.localeCompare(b));
}

export default function contextRouter(pi: ExtensionAPI): void {
  const selectedTools = new Set<string>();
  let cachedSkills: SkillRecord[] = [];
  let lastPromptInputBytes = 0;
  let lastPromptOutputBytes = 0;
  let lastByteDelta = 0;
  let lastSanitizerOutcome: SanitizerOutcome = "absent";

  pi.registerCommand("context-router-debug", {
    description: "Display count-only context-router status diagnostics",
    async handler(_args, ctx) {
      const registeredToolsCount = pi.getAllTools().length;
      const activeToolsCount = pi.getActiveTools().length;
      const selectedToolsCount = selectedTools.size;
      const loadedSkillsCount = cachedSkills.length;
      const message = `Context Router Debug: registeredTools=${registeredToolsCount} activeTools=${activeToolsCount} selectedTools=${selectedToolsCount} loadedSkills=${loadedSkillsCount} promptInputBytes=${lastPromptInputBytes} promptOutputBytes=${lastPromptOutputBytes} byteDelta=${lastByteDelta} sanitizerOutcome=${lastSanitizerOutcome}`;
      ctx.ui.notify(message, "info");
    },
  });

  pi.registerTool({
    name: "find_tools",
    label: "Find tools",
    description: "Find registered parent tools by capability.",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 160 }),
      select: Type.Optional(Type.Array(Type.String({ maxLength: 80 }), { maxItems: 8 })),
    }),
    async execute(_toolCallId, input: FindToolsInput) {
      const registeredNames = currentRegisteredNames(pi);
      const matches = projectToolCatalog(
        pi.getAllTools() as unknown as ToolRecord[],
        pi.getActiveTools(),
        input.query,
      );
      const accepted = selectCurrentToolMatches(matches, input.select ?? [], registeredNames);
      for (const name of accepted) selectedTools.add(name);

      const active = pi.getActiveTools();
      const added = accepted.filter((name) => !active.includes(name));
      pi.setActiveTools([...new Set([...active, ...added])]);

      const visibleMatches = matches.map((match) => ({
        ...match,
        selected: accepted.includes(match.name),
        added: added.includes(match.name),
      }));
      return {
        content: [{ type: "text", text: JSON.stringify({ matches: visibleMatches }) }],
        details: { matches: matches.map((match) => match.name), added },
      };
    },
  });

  pi.registerTool({
    name: "find_skills",
    label: "Find skills",
    description: "Find loaded skills by capability.",
    parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 160 }) }),
    async execute(_toolCallId, input: FindSkillsInput) {
      const matches = projectSkillCatalog(cachedSkills, input.query);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              matches,
              instruction: "Use the read tool on a skill's path to inspect its full SKILL.md instructions.",
            }),
          },
        ],
        details: { matches: matches.map((match) => match.name) },
      };
    },
  });

  pi.on("session_start", () => {
    cachedSkills = [];
    applySessionToolSet(pi, selectedTools);
  });
  pi.on("turn_start", () => applySessionToolSet(pi, selectedTools));
  pi.on("before_agent_start", (event) => {
    cachedSkills = (event.systemPromptOptions?.skills as unknown as SkillRecord[]) ?? [];
    const result = sanitizeSkillsPrompt(event.systemPrompt, cachedSkills);
    lastPromptInputBytes = event.systemPrompt.length;
    lastPromptOutputBytes = result.systemPrompt.length;
    lastByteDelta = result.byteDelta;
    lastSanitizerOutcome = result.outcome;

    const allTools = pi.getAllTools() as unknown as ToolRecord[];
    const activeNames = pi.getActiveTools();
    const summaries = buildToolSummaries(allTools);
    const suppressed = buildSuppressedTools(allTools, activeNames);
    const skillNames = cachedSkills
      .map((skill) => typeof skill.name === "string" ? skill.name : "")
      .filter(Boolean);

    const availabilitySection = buildAvailabilityPrompt({
      summaries,
      suppressedTools: suppressed,
      skillNames,
    });

    const systemPrompt = result.outcome === "replaced" ? result.systemPrompt : event.systemPrompt;
    return { systemPrompt: systemPrompt + "\n\n" + availabilitySection };
  });

  pi.on("tool_call", (event) => {
    const allTools = pi.getAllTools() as unknown as ToolRecord[];
    const activeNames = pi.getActiveTools();
    const toolName = event.toolName;

    // Check if this is a registered but inactive non-MCP tool
    if (activeNames.includes(toolName)) return; // Already active, let it proceed normally

    const tool = allTools.find((t) => t.name === toolName);
    if (!tool) return; // Not registered, let Pi handle the error

    const source = typeof tool.sourceInfo?.source === "string" ? tool.sourceInfo.source : "";
    if (isMcpTool(source, toolName)) return; // MCP tools require explicit activation via find_tools

    // Lazy activation: add the tool to the active set
    pi.setActiveTools([...activeNames, toolName]);
  });
  pi.on("session_shutdown", () => {
    selectedTools.clear();
    cachedSkills = [];
  });
}
