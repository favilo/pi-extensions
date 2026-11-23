import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";

test("Rust annotates the matching result with session steering once", async () => {
  const native = createRequire(import.meta.url)("./native/generated/index.js");
  const handlers = new Map<
    string,
    (event: unknown, context: unknown) => unknown
  >();
  const cleaned: string[] = [];
  const bridge = {
    handleToolCall: () => undefined,
    handleToolResult: (event: unknown) => {
      cleaned.push((event as { toolCallId: string }).toolCallId);
    },
    recordSteering: (_id: string, _text: string): boolean => false,
    discardSteering: (_id: string): boolean => false,
  };
  native.registerToolPermissionsCallbacks(
    {
      version: NATIVE_CONTRACT_VERSION,
      operation: "register_callbacks",
      nonce: "steering-ownership",
    },
    {
      on(name: string, handler: (event: unknown, context: unknown) => unknown) {
        handlers.set(name, handler);
      },
      registerCommand() {},
      registerEntryRenderer() {},
    },
    bridge,
  );
  assert.equal(bridge.recordSteering("first", "review this"), true);
  const result = await handlers.get("tool_result")!(
    { toolCallId: "first", content: [] },
    {},
  );
  assert.deepEqual(cleaned, ["first"]);
  assert.deepEqual(result, {
    content: [
      {
        type: "text",
        text: '\n\n<user-steering source="permission-prompt">\nreview this\n</user-steering>',
      },
    ],
  });
  assert.equal(
    await handlers.get("tool_result")!(
      { toolCallId: "first", content: [] },
      {},
    ),
    undefined,
  );
  assert.equal(bridge.recordSteering("cancelled", "do not deliver"), true);
  assert.equal(bridge.discardSteering("cancelled"), true);
  assert.equal(
    await handlers.get("tool_result")!(
      { toolCallId: "cancelled", content: [] },
      {},
    ),
    undefined,
  );
  assert.equal(bridge.recordSteering("pending", "never deliver"), true);
  await handlers.get("session_shutdown")!({}, {});
  assert.equal(bridge.recordSteering("late", "ignore"), false);
  assert.equal(
    await handlers.get("tool_result")!(
      { toolCallId: "pending", content: [] },
      {},
    ),
    undefined,
  );
});
