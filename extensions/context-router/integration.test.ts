import "../test-support/forbid-fetch.ts";
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import contextRouter from "./index.ts";

test("PROVENANCE.md exists with required attribution metadata", () => {
  const provenancePath = join(import.meta.dirname, "PROVENANCE.md");
  assert.ok(existsSync(provenancePath), "PROVENANCE.md must exist");
  const content = readFileSync(provenancePath, "utf8");
  assert.match(content, /SeanPedersen\/pi-context-skills/);
  assert.match(content, /5493713bcff23f29d00d113bc9d3c9294596b18a/);
  assert.match(content, /MIT/);
});

test("package.json registers context-router last in pi.extensions list", () => {
  const packageJsonPath = join(import.meta.dirname, "..", "..", "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const extensions: string[] = pkg.pi?.extensions ?? [];
  assert.ok(extensions.length > 0, "extensions array must not be empty");
  assert.strictEqual(
    extensions[extensions.length - 1],
    "./extensions/context-router/index.ts",
    "context-router must be registered last in package.json extensions list",
  );
});

test("context-router-debug command outputs count-only diagnostics without details or credentials", async () => {
  const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> | void }>();
  let notifiedMessage = "";

  const mockPi = {
    registerTool() {},
    registerCommand(name: string, command: { handler: (args: string, ctx: any) => Promise<void> | void }) {
      commands.set(name, command);
    },
    on() {},
    getAllTools: () => [{ name: "read", description: "Read file" }, { name: "secret_tool", description: "sk-secret123456789012" }],
    getActiveTools: () => ["read"],
  };

  contextRouter(mockPi as any);

  const debugCmd = commands.get("context-router-debug");
  assert.ok(debugCmd, "context-router-debug command must be registered");

  const mockCtx = {
    ui: {
      notify(msg: string) {
        notifiedMessage = msg;
      },
    },
  };

  await debugCmd.handler("", mockCtx);

  assert.match(notifiedMessage, /registeredTools=2/);
  assert.match(notifiedMessage, /activeTools=1/);
  assert.match(notifiedMessage, /selectedTools=0/);
  assert.match(notifiedMessage, /loadedSkills=0/);
  assert.match(notifiedMessage, /sanitizerOutcome=/);
  assert.doesNotMatch(notifiedMessage, /secret_tool|sk-secret|Read file/);
});
