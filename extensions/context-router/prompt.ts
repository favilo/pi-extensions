import { formatSkillsForPrompt, type Skill } from "@earendil-works/pi-coding-agent";
import type { SkillRecord } from "./catalog.ts";

export type SanitizerOutcome = "replaced" | "absent" | "ambiguous";

export type AvailabilityOptions = {
  summaries: Array<{ name: string; description: string }>;
  suppressedTools: string[];
  skillNames: string[];
};

const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_SUPPRESSED_TOOLS = 100;
const MAX_SKILL_NAMES = 100;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeName(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

function normalizeDescription(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DESCRIPTION_LENGTH);
}

export function buildAvailabilityPrompt(options: AvailabilityOptions): string {
  const lines: string[] = [];
  lines.push("## Available Tools");
  lines.push("");
  lines.push("The following tools are registered and callable:");
  lines.push("");

  const sortedSummaries = [...options.summaries]
    .filter((s) => normalizeName(s.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const summary of sortedSummaries) {
    const name = normalizeName(summary.name);
    const description = normalizeDescription(summary.description);
    lines.push(`- ${escapeXml(name)}: ${escapeXml(description)}`);
  }

  if (sortedSummaries.length === 0) {
    lines.push("(none)");
  }

  lines.push("");

  const sortedSuppressed = [...options.suppressedTools]
    .map(normalizeName)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_SUPPRESSED_TOOLS);

  if (sortedSuppressed.length > 0) {
    lines.push("## Suppressed Tools");
    lines.push("These tools are registered but inactive. Call them directly to activate:");
    lines.push("<suppressed_tools>");
    for (const name of sortedSuppressed) {
      lines.push(`  <tool>${escapeXml(name)}</tool>`);
    }
    lines.push("</suppressed_tools>");
    lines.push("");
  }

  const sortedSkills = [...options.skillNames]
    .map(normalizeName)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_SKILL_NAMES);

  if (sortedSkills.length > 0) {
    lines.push("## Available Skills");
    lines.push("Use `find_skills` to discover capabilities, or `/skill:name` to invoke:");
    lines.push("<available_skills>");
    for (const name of sortedSkills) {
      lines.push(`  <skill>${escapeXml(name)}</skill>`);
    }
    lines.push("</available_skills>");
    lines.push("");
  }

  return lines.join("\n");
}

export type PromptSanitizeResult = {
  systemPrompt: string;
  outcome: SanitizerOutcome;
  count: number;
  byteDelta: number;
};

function countOccurrences(value: string, target: string): number {
  if (!target) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const match = value.indexOf(target, offset);
    if (match === -1) return count;
    count += 1;
    offset = match + target.length;
  }
}

export function sanitizeSkillsPrompt(
  systemPrompt: string,
  skills: readonly SkillRecord[],
): PromptSanitizeResult {
  const sourceSection = formatSkillsForPrompt(skills as unknown as Skill[]);
  const replacementSection = formatSkillsForPrompt([]);

  if (!sourceSection || sourceSection === replacementSection) {
    return {
      systemPrompt,
      outcome: "absent",
      count: 0,
      byteDelta: 0,
    };
  }

  const count = countOccurrences(systemPrompt, sourceSection);

  if (count === 0) {
    return {
      systemPrompt,
      outcome: "absent",
      count: 0,
      byteDelta: 0,
    };
  }

  if (count > 1) {
    return {
      systemPrompt,
      outcome: "ambiguous",
      count,
      byteDelta: 0,
    };
  }

  const newPrompt = systemPrompt.replace(sourceSection, replacementSection);
  return {
    systemPrompt: newPrompt,
    outcome: "replaced",
    count: 1,
    byteDelta: newPrompt.length - systemPrompt.length,
  };
}
