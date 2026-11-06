import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, Skill } from "@earendil-works/pi-coding-agent";
import activateSkill from "./index.ts";

type RegisteredTool = {
  name: string;
  description: string;
  promptGuidelines?: string[];
  execute(toolCallId: string, params: { name: string }): Promise<{
    content: Array<{ type: string; text?: string }>;
    details?: unknown;
  }>;
};

type BeforeAgentStartHandler = (event: {
  systemPromptOptions?: { skills?: Skill[] };
}) => void;

function extensionHarness() {
  let tool: RegisteredTool | undefined;
  const beforeAgentStartHandlers: BeforeAgentStartHandler[] = [];
  const pi = {
    registerTool(candidate: RegisteredTool) {
      tool = candidate;
    },
    on(name: string, handler: BeforeAgentStartHandler) {
      if (name === "before_agent_start") beforeAgentStartHandlers.push(handler);
    },
  } as unknown as ExtensionAPI;

  activateSkill(pi);
  return {
    tool: () => tool,
    setSkills(skills: Skill[]) {
      for (const handler of beforeAgentStartHandlers) {
        handler({ systemPromptOptions: { skills } });
      }
    },
  };
}

function makeSkill(name: string, filePath: string, disableModelInvocation = false): Skill {
  return {
    name,
    description: `${name} description`,
    filePath,
    baseDir: filePath.slice(0, filePath.lastIndexOf("/")),
    disableModelInvocation,
    sourceInfo: {
      source: "test",
      path: filePath,
      scope: "user",
      origin: "top-level",
    },
  };
}

test("registers activate_skill as a normal Pi tool with model guidance", () => {
  const tool = extensionHarness().tool();

  assert.ok(tool);
  assert.equal(tool.name, "activate_skill");
  assert.match(tool.description, /Load full Pi Agent Skill instructions/);
  assert.ok(tool.promptGuidelines?.some((line) => line.includes("activate_skill")));
});

test("loads a visible skill and returns its base directory through Pi tool execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-activate-skill-"));
  try {
    const skillDir = join(root, "proof");
    await mkdir(skillDir);
    const skillPath = join(skillDir, "SKILL.md");
    await writeFile(skillPath, "---\nname: proof\ndescription: Proof skill\n---\nFollow the proof instructions.\n");
    const harness = extensionHarness();
    harness.setSkills([makeSkill("proof", skillPath)]);

    const result = await harness.tool()!.execute("call-1", { name: " proof " });
    const text = result.content.map((block) => block.text ?? "").join("\n");

    assert.match(text, /Follow the proof instructions/);
    assert.match(text, new RegExp(`Skill directory: ${skillDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.deepEqual(result.details, { name: "proof", filePath: skillPath, baseDir: skillDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unavailable and explicit-only skills without reading them", async () => {
  const harness = extensionHarness();
  harness.setSkills([makeSkill("manual", "/private/manual/SKILL.md", true)]);

  await assert.rejects(
    () => harness.tool()!.execute("call-2", { name: "manual" }),
    /Skill not available: manual\. Available skills: none/,
  );
});
