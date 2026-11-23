import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";

test("a malformed tool call is blocked before the authorization callback", async () => {
  const native = createRequire(import.meta.url)("./native/generated/index.js");
  const handlers = new Map<string, (event: unknown, context: unknown) => unknown>();
  let delegated = false;
  native.registerToolPermissionsCallbacks(
    { version: NATIVE_CONTRACT_VERSION, operation: "register_callbacks", nonce: "invalid-tool-call" },
    {
      on(name: string, handler: (event: unknown, context: unknown) => unknown) { handlers.set(name, handler); },
      registerCommand() {},
      registerEntryRenderer() {},
    },
    { handleToolCall: () => { delegated = true; } },
  );
  const result = await handlers.get("tool_call")!({ input: {} }, {});
  assert.equal(delegated, false);
  assert.equal((result as { block: boolean }).block, true);
});
