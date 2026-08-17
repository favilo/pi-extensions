import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  projectSkillCatalog,
  projectToolCatalog,
  selectCurrentToolMatches,
  type SkillRecord,
  type ToolRecord,
} from "./catalog.ts";
import { sanitizeSkillsPrompt, type SanitizerOutcome } from "./prompt.ts";

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
    if (result.outcome === "replaced") {
      return { systemPrompt: result.systemPrompt };
    }
  });
  pi.on("session_shutdown", () => {
    selectedTools.clear();
    cachedSkills = [];
  });
}
