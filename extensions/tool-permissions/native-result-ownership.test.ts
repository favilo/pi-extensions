import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";

test("tool results without steering are handled without a TypeScript result callback", async () => {
  const native = createRequire(import.meta.url)("./native/generated/index.js");
  const handlers = new Map<string, (event: unknown, context: unknown) => unknown>();
  native.registerToolPermissionsCallbacks(
    { version: NATIVE_CONTRACT_VERSION, operation: "register_callbacks", nonce: "rust-result-ownership" },
    {
      on(name: string, handler: (event: unknown, context: unknown) => unknown) { handlers.set(name, handler); },
      registerCommand() {},
      registerEntryRenderer() {},
    },
    { handleToolCall: () => undefined },
  );
  assert.ok(handlers.has("tool_result"), "Rust must register result handling without a bridge callback");
  assert.equal(await handlers.get("tool_result")!({ toolCallId: "no-steering", content: [] }, {}), undefined);
});
