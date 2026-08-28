import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import enableExtraTools from "./index.ts";

type RegisteredCommand = {
  handler(args: string, ctx: unknown): Promise<void> | void;
};

function extensionHarness(initialActive: string[]) {
  const events = new Map<string, Array<() => void>>();
  const commands = new Map<string, RegisteredCommand>();
  let activeTools = [...initialActive];
  const configuredTools = ["read", "grep", "find", "ls", "custom"];
  const pi = {
    on(name: string, handler: () => void) {
      events.set(name, [...(events.get(name) ?? []), handler]);
    },
    registerCommand(name: string, command: RegisteredCommand) {
      commands.set(name, command);
    },
    getActiveTools: () => activeTools,
    setActiveTools(names: string[]) {
      activeTools = names;
    },
    getAllTools: () => configuredTools.map((name) => ({ name })),
  } as unknown as ExtensionAPI;

  enableExtraTools(pi);
  return {
    startSession() {
      for (const handler of events.get("session_start") ?? []) handler();
    },
    activeTools: () => activeTools,
    debugCommand: commands.get("tools-debug")?.handler,
  };
}

test("session start enables extra tools once while preserving active tools", () => {
  const harness = extensionHarness(["read", "grep"]);

  harness.startSession();
  harness.startSession();

  assert.deepEqual(harness.activeTools(), ["read", "grep", "find", "ls", "bash_task"]);
});

test("tools-debug reports active and configured tool names", async () => {
  const harness = extensionHarness(["read"]);
  harness.startSession();
  const handler = harness.debugCommand;
  assert.ok(handler);
  const notifications: Array<{ message: string; level: string }> = [];
  const context = {
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  };

  await handler("", context);

  assert.deepEqual(notifications, [
    { message: "Active: read, grep, find, ls, bash_task", level: "info" },
    { message: "All: read, grep, find, ls, custom", level: "info" },
  ]);
});
