import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import exitAlias from "./index.ts";

type RegisteredCommand = {
  description?: string;
  handler(args: string, ctx: unknown): Promise<void> | void;
};

test("exit is a graceful alias that delegates to context shutdown", async () => {
  let command: RegisteredCommand | undefined;
  const pi = {
    registerCommand(name: string, registered: RegisteredCommand) {
      assert.equal(name, "exit");
      command = registered;
    },
  } as unknown as ExtensionAPI;
  exitAlias(pi);
  assert.ok(command);
  let shutdownCalls = 0;
  const context = {
    shutdown() {
      shutdownCalls += 1;
    },
  };

  await command.handler("", context);

  assert.equal(command.description, "Alias for /quit");
  assert.equal(shutdownCalls, 1);
});
