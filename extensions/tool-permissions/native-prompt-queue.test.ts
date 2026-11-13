import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import {
  NATIVE_PROMPT_QUEUE_NONCE,
  PromptQueueDecision,
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
    () => PromptQueueDecision.Allow,
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
    { ok: true, toolCallId, decision: PromptQueueDecision.Allow },
  );
});

test("an asynchronous prompt allow stays bound to its tool-call", async () => {
  const toolCallId = "call-async-allow";
  const result = await presentBoundPrompt(
    {
      version: NATIVE_CONTRACT_VERSION,
      operation: "prompt_queue",
      nonce: NATIVE_PROMPT_QUEUE_NONCE,
      toolCallId,
    },
    async () => PromptQueueDecision.Allow,
  );

  assert.deepEqual(
    {
      ok: result.ok,
      toolCallId: result.toolCallId,
      decision: result.decision,
    },
    { ok: true, toolCallId, decision: PromptQueueDecision.Allow },
  );
});
