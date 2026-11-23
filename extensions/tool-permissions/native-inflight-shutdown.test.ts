import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";

test("an authorization resolved after shutdown cannot allow a tool call", async () => {
  const native = createRequire(import.meta.url)("./native/generated/index.js");
  const handlers = new Map<
    string,
    (event: unknown, context: unknown) => unknown
  >();
  let resolve!: (value: unknown) => void;
  const pending = new Promise<unknown>((done) => {
    resolve = done;
  });
  native.registerToolPermissionsCallbacks(
    {
      version: NATIVE_CONTRACT_VERSION,
      operation: "register_callbacks",
      nonce: "inflight-shutdown",
    },
    {
      on(name: string, handler: (event: unknown, context: unknown) => unknown) {
        handlers.set(name, handler);
      },
      registerCommand() {},
      registerEntryRenderer() {},
    },
    { authorizeToolCall: () => pending },
  );
  const result = Promise.resolve(
    handlers.get("tool_call")!(
      { toolName: "read", toolCallId: "pending", input: {} },
      {},
    ),
  );
  await handlers.get("session_shutdown")!({}, {});
  resolve(undefined);
  assert.equal(((await result) as { block: boolean }).block, true);
});
