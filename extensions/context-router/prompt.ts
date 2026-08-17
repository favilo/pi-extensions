import { formatSkillsForPrompt, type Skill } from "@earendil-works/pi-coding-agent";
import type { SkillRecord } from "./catalog.ts";

export type SanitizerOutcome = "replaced" | "absent" | "ambiguous";

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
