import { formatSkillsForPrompt, type Skill } from "@earendil-works/pi-coding-agent";
import type { SkillRecord } from "./catalog.ts";

export type SanitizerOutcome = "replaced" | "absent" | "ambiguous";

export type AvailabilityOptions = {
  summaries: Array<{ name: string; description: string }>;
  suppressedTools: string[];
  skillNames: string[];
};

const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 120;
const MAX_SUPPRESSED_TOOLS = 50;
const MAX_SKILL_NAMES = 50;

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
  const parts: string[] = [];

  // Summaries: name + short description (truncated with ellipsis)
  const summaries = [...options.summaries]
    .filter((s) => normalizeName(s.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (summaries.length > 0) {
    const summaryLine = summaries
      .map((s) => {
        const name = escapeXml(normalizeName(s.name));
        const desc = escapeXml(normalizeDescription(s.description));
        return desc ? `${name}(${desc}…)` : name;
      })
      .join(", ");
    parts.push(`Tools: ${summaryLine}`);
  }

  // Suppressed: just names, comma-separated
  const suppressed = [...options.suppressedTools]
    .map(normalizeName)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_SUPPRESSED_TOOLS);

  if (suppressed.length > 0) {
    parts.push(`Suppressed: ${suppressed.map(escapeXml).join(", ")}`);
  }

  // Skills: just names, comma-separated
  const skills = [...options.skillNames]
    .map(normalizeName)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_SKILL_NAMES);

  if (skills.length > 0) {
    parts.push(`Skills: ${skills.map(escapeXml).join(", ")}`);
  }

  if (parts.length === 0) return "";
  return "\n" + parts.join("; ") + "\n";
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
