import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import clearReloadExtension from "./index.ts";

type RegisteredCommand = {
  handler(args: string, ctx: unknown): Promise<void> | void;
};

function commandHarness() {
  const commands = new Map<string, RegisteredCommand>();
  const pi = {
    registerCommand(name: string, command: RegisteredCommand) {
      commands.set(name, command);
    },
  } as unknown as ExtensionAPI;

  clearReloadExtension(pi);
  return commands.get("clear")?.handler;
}

test("clear waits for idle, replaces the session, and reloads the replacement context", async () => {
  const handler = commandHarness();
  assert.ok(handler);
  const calls: string[] = [];
  const notifications: Array<{ message: string; level: string }> = [];
  const replacementContext = {
    hasUI: true,
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
    async reload() {
      calls.push("reload");
    },
  };
  const context = {
    hasUI: true,
    ui: { notify() {} },
    async waitForIdle() {
      calls.push("waitForIdle");
    },
    sessionManager: {
      getSessionFile: () => "/sessions/current.jsonl",
    },
    async newSession(options: {
      parentSession?: string;
      withSession(context: typeof replacementContext): Promise<void>;
    }) {
      calls.push(`newSession:${options.parentSession}`);
      await options.withSession(replacementContext);
      return { cancelled: false };
    },
  };

  await handler("", context);

  assert.deepEqual(calls, ["waitForIdle", "newSession:/sessions/current.jsonl", "reload"]);
  assert.deepEqual(notifications, [
    { message: "Context cleared. Reloading plugins…", level: "info" },
  ]);
});

test("clear warns through the current context when replacement is cancelled", async () => {
  const handler = commandHarness();
  assert.ok(handler);
  const notifications: Array<{ message: string; level: string }> = [];
  const context = {
    hasUI: true,
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
    async waitForIdle() {},
    sessionManager: { getSessionFile: () => undefined },
    async newSession() {
      return { cancelled: true };
    },
  };

  await handler("", context);

  assert.deepEqual(notifications, [
    { message: "/clear cancelled by another extension.", level: "warning" },
  ]);
});
