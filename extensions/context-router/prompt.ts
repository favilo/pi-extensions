import type { SkillRecord } from "./catalog.ts";

export type SanitizerOutcome = "replaced" | "absent" | "ambiguous";

export type PromptSanitizeResult = {
  systemPrompt: string;
  outcome: SanitizerOutcome;
  count: number;
  byteDelta: number;
};

export function sanitizeSkillsPrompt(
  systemPrompt: string,
  _skills: readonly SkillRecord[],
): PromptSanitizeResult {
  return {
    systemPrompt,
    outcome: "absent",
    count: 0,
    byteDelta: 0,
  };
}
