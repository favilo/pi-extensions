import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import localAgentContext from "./index.ts";

type AgentStartHandler = (
  event: { systemPrompt: string },
  ctx: { cwd: string },
) => { systemPrompt: string } | undefined;

function extensionHandler(): AgentStartHandler {
  let handler: AgentStartHandler | undefined;
  const pi = {
    on(name: string, registered: AgentStartHandler) {
      assert.equal(name, "before_agent_start");
      handler = registered;
    },
  } as unknown as ExtensionAPI;

  localAgentContext(pi);
  assert.ok(handler);
  return handler;
}

function temporaryDirectory(t: test.TestContext): string {
  const path = mkdtempSync(join(tmpdir(), "pi-local-context-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

test("local context loads broad guidance before nearest overrides and stops at the Git boundary", (t) => {
  const root = temporaryDirectory(t);
  const project = join(root, "project");
  const packages = join(project, "packages");
  const app = join(packages, "app");
  mkdirSync(join(project, ".git"), { recursive: true });
  mkdirSync(app, { recursive: true });
  writeFileSync(join(root, "AGENTS.local.md"), "outside boundary");
  writeFileSync(join(project, "AGENTS.local.md"), "  project guidance  \n");
  writeFileSync(join(project, "AGENTS.override.md"), "project override");
  writeFileSync(join(packages, "AGENTS.local.md"), "package guidance");
  writeFileSync(join(app, "AGENTS.override.md"), "app override");
  const handler = extensionHandler();

  const result = handler({ systemPrompt: "BASE" }, { cwd: app });

  assert.ok(result);
  assert.doesNotMatch(result.systemPrompt, /outside boundary/);
  assert.doesNotMatch(result.systemPrompt, /  project guidance  /);
  const expectedInOrder = [
    `# Additional local context: ${join(project, "AGENTS.local.md")}\n\nproject guidance`,
    `# Additional local context: ${join(project, "AGENTS.override.md")}\n\nproject override`,
    `# Additional local context: ${join(packages, "AGENTS.local.md")}\n\npackage guidance`,
    `# Additional local context: ${join(app, "AGENTS.override.md")}\n\napp override`,
  ];
  let previousIndex = result.systemPrompt.indexOf("BASE");
  for (const section of expectedInOrder) {
    const index = result.systemPrompt.indexOf(section);
    assert.ok(index > previousIndex, `expected section in order: ${section}`);
    previousIndex = index;
  }
});

test("local context leaves the system prompt unchanged when files are absent or empty", (t) => {
  const project = temporaryDirectory(t);
  const app = join(project, "app");
  mkdirSync(join(project, ".git"), { recursive: true });
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, "AGENTS.local.md"), "  \n");
  const handler = extensionHandler();

  const result = handler({ systemPrompt: "BASE" }, { cwd: app });

  assert.equal(result, undefined);
});
