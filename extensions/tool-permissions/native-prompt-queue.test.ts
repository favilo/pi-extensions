import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import {
  NATIVE_PROMPT_QUEUE_NONCE,
  presentBoundPrompt,
} from "./native-prompt-queue.ts";

test("an allow stays bound to the tool-call that opened the prompt", async () => {
  const toolCallId = "call-allow";
  const result = await presentBoundPrompt(
    {
      version: NATIVE_CONTRACT_VERSION,
      operation: "prompt_queue",
      nonce: NATIVE_PROMPT_QUEUE_NONCE,
      toolCallId,
    },
    () => "allow",
  );
  console.log(
    JSON.stringify({
      toolCallId,
      ok: result.ok,
      boundId: result.toolCallId,
      decision: result.decision,
    }),
  );

  assert.deepEqual(
    {
      ok: result.ok,
      toolCallId: result.toolCallId,
      decision: result.decision,
    },
    { ok: true, toolCallId, decision: "allow" },
  );
});
