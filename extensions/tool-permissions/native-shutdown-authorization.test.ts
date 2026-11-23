import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";

test("a tool call after session shutdown is not authorized by the delegated handler", async () => {
  const native = createRequire(import.meta.url)("./native/generated/index.js");
  const handlers = new Map<
    string,
    (event: unknown, context: unknown) => unknown
  >();
  let calls = 0;
  native.registerToolPermissionsCallbacks(
    {
      version: NATIVE_CONTRACT_VERSION,
      operation: "register_callbacks",
      nonce: "shutdown-authorization",
    },
    {
      on(name: string, handler: (event: unknown, context: unknown) => unknown) {
        handlers.set(name, handler);
      },
      registerCommand() {},
      registerEntryRenderer() {},
    },
    {
      authorizeToolCall() {
        calls++;
        return undefined;
      },
    },
  );
  await handlers.get("session_shutdown")!({}, {});
  const result = await handlers.get("tool_call")!(
    { toolName: "read", toolCallId: "late", input: {} },
    {},
  );
  assert.equal(calls, 0);
  assert.equal((result as { block: boolean }).block, true);
});
