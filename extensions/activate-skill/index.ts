import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExtensionAPI, Skill } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type ActivateSkillParams = { name: string };

function visibleSkills(skills: readonly Skill[] | undefined): Skill[] {
  return (skills ?? []).filter((skill) => !skill.disableModelInvocation);
}

export default function activateSkill(pi: ExtensionAPI): void {
  let skillsByName = new Map<string, Skill>();

  pi.on("before_agent_start", (event) => {
    skillsByName = new Map(
      visibleSkills(event.systemPromptOptions?.skills).map((skill) => [
        skill.name,
        skill,
      ]),
    );
  });

  pi.registerTool({
    name: "activate_skill",
    label: "Activate skill",
    description:
      "Load full Pi Agent Skill instructions by name through Pi's normal tool and permission pipeline.",
    promptGuidelines: [
      "When a task matches an available skill, call activate_skill with its name before applying that skill.",
      "Resolve relative paths from the Skill directory returned by activate_skill.",
    ],
    parameters: Type.Object({
      name: Type.String({
        description: "Skill name from the current available-skills catalog",
      }),
    }),
    async execute(_toolCallId, params) {
      const requestedName = (params as ActivateSkillParams).name.trim();
      const skill = skillsByName.get(requestedName);
      if (!skill) {
        const available = [...skillsByName.keys()].sort().join(", ") || "none";
        throw new Error(
          `Skill not available: ${requestedName || "(empty)"}. Available skills: ${available}`,
        );
      }

      const content = await readFile(skill.filePath, "utf8");
      const baseDir = skill.baseDir || dirname(skill.filePath);
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `<skill_content name="${skill.name}">`,
              content.trim(),
              "",
              `Skill directory: ${baseDir}`,
              "Relative paths in this skill are relative to the Skill directory.",
              "</skill_content>",
            ].join("\n"),
          },
        ],
        details: {
          name: skill.name,
          filePath: skill.filePath,
          baseDir,
        },
      };
    },
  });
}
